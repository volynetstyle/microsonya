import { describe, expect, it, vi } from "vitest";
import {
  MemoriesRepo,
  MessagesRepo,
  SummariesRepo,
} from "../packages/db/src/index.js";
import {
  InvalidModelOutputError,
  ModelGateway,
  type ModelClient,
} from "../packages/model-gateway/src/index.js";
import {
  segmentMessages,
  selectSummaryWindow,
  reconstructionOutputTokenBudget,
  summarize,
  type SummaryWaterfallEvent,
  waitForMemoryIdle,
} from "../packages/summarize/src/index.js";
import type { ChatMessage } from "../packages/shared/src/index.js";
import { openTestDb } from "./dbTestUtils.js";

const now = new Date("2026-06-24T12:00:00.000Z").getTime();

describe("selectSummaryWindow", () => {
  it("selects recent text messages after the last summary within 12 hours", () => {
    const messages = [
      message(1, now - 13 * 60 * 60 * 1000),
      message(2, now - 60_000),
      message(3, now),
    ];

    const selected = selectSummaryWindow(
      { chatId: "chat", commandMessageId: 4, date: now, mode: "recent" },
      messages,
      {
        id: "run",
        chatId: "chat",
        commandMessageId: 2,
        createdAt: now,
        fromMessageId: 1,
        toMessageId: 2,
        mode: "recent",
        status: "ok",
        finalText: "done",
      },
    );

    expect(selected.map((item) => item.id)).toEqual([3]);
  });

  it("supports explicit count mode", () => {
    const selected = selectSummaryWindow(
      {
        chatId: "chat",
        commandMessageId: 5,
        date: now,
        mode: "count",
        count: 2,
      },
      [message(1, now), message(2, now), message(3, now)],
    );

    expect(selected.map((item) => item.id)).toEqual([2, 3]);
  });

  it("excludes command messages from summaries", () => {
    const selected = selectSummaryWindow(
      {
        chatId: "chat",
        commandMessageId: 3,
        date: now,
        mode: "count",
        count: 3,
      },
      [
        message(1, now, "hello"),
        message(2, now, "/summarize"),
        message(3, now, "world"),
      ],
    );

    expect(selected.map((item) => item.text)).toEqual(["hello", "world"]);
  });
});

describe("segmentMessages", () => {
  it("splits messages after a 30 minute gap", () => {
    const segments = segmentMessages([
      message(1, now),
      message(2, now + 31 * 60 * 1000),
    ]);

    expect(segments).toHaveLength(2);
    expect(segments[0]?.reason).toBe("time_gap");
  });
});

describe("reconstructionOutputTokenBudget", () => {
  it("scales with segment size and stays within safe bounds", () => {
    expect(reconstructionOutputTokenBudget(1)).toBe(2_048);
    expect(reconstructionOutputTokenBudget(13)).toBe(4_672);
    expect(reconstructionOutputTokenBudget(100)).toBe(8_192);
  });
});

describe("summarize", () => {
  it("persists semantic memory and reuses cached segment reconstructions", async () => {
    const { db, close } = await openTestDb();
    const messages = new MessagesRepo(db);
    const memory = new MemoriesRepo(db);
    const summaries = new SummariesRepo(db);
    await messages.save(message(1, now, "hello"));
    await messages.save(message(2, now + 1, "world"));

    const summaryClient: ModelClient = {
      generateText: vi.fn(async () => "summary"),
      generateObject: vi.fn(async (_prompt, schema) => {
        return schema.parse(reconstruction("hello world", [1, 2]));
      }),
    };
    const memoryClient: ModelClient = {
      generateText: vi.fn(async () => "unused"),
      generateObject: vi.fn(async (_prompt, schema) => {
        return schema.parse({
          operations: [
            {
              type: "create",
              kind: "decision",
              text: "Remember hello world",
              evidence: [1],
            },
          ],
        });
      }),
    };

    const command = {
      chatId: "chat",
      commandMessageId: 3,
      date: now + 2,
      mode: "count" as const,
      count: 2,
    };

    await summarize(
      {
        memory,
        messages,
        summaries,
        models: new ModelGateway(summaryClient),
        memoryModels: new ModelGateway(memoryClient),
        onTrace: vi.fn(),
      },
      command,
    );
    await waitForMemoryIdle("chat");
    await summarize(
      {
        memory,
        messages,
        summaries,
        models: new ModelGateway(summaryClient),
        memoryModels: new ModelGateway(memoryClient),
        onTrace: vi.fn(),
      },
      command,
    );
    await waitForMemoryIdle("chat");

    expect(summaryClient.generateObject).toHaveBeenCalledTimes(1);
    expect(memoryClient.generateObject).toHaveBeenCalledTimes(1);
    expect(memoryClient.generateObject).toHaveBeenCalledWith(
      expect.any(String),
      expect.anything(),
      expect.objectContaining({
        operation: "memory-extraction",
        chatId: "chat",
        commandMessageId: 3,
        memoryBatch: 1,
        messageCount: 2,
        fromMessageId: 1,
        toMessageId: 2,
        watermarkBefore: null,
      }),
      undefined,
    );
    await expect(memory.findState("chat")).resolves.toMatchObject({
      version: 1,
      processedThroughMessageId: 2,
      items: [
        expect.objectContaining({
          id: "mem_000001",
          kind: "decision",
          text: "Remember hello world",
          evidence: [1],
        }),
      ],
    });
    await close();
  });

  it("accepts the evidence-grounded eval summary contract", async () => {
    const { db, close } = await openTestDb();
    const messages = new MessagesRepo(db);
    const memory = new MemoriesRepo(db);
    const summaries = new SummariesRepo(db);
    await messages.save(message(1, now, "hello"));

    const summaryClient: ModelClient = {
      generateText: vi.fn(async () => "unused"),
      generateObject: vi.fn(async (_prompt, schema) => {
        return schema.parse(reconstruction("hello only", [1]));
      }),
    };
    const memoryClient: ModelClient = {
      generateText: vi.fn(async () => "unused"),
      generateObject: vi.fn(async (_prompt, schema) =>
        schema.parse({ operations: [] }),
      ),
    };

    const command = {
      chatId: "chat",
      commandMessageId: 2,
      date: now + 1,
      mode: "count" as const,
      count: 1,
    };

    await expect(
      summarize(
        {
          memory,
          messages,
          summaries,
          models: new ModelGateway(summaryClient),
          memoryModels: new ModelGateway(memoryClient),
          onTrace: vi.fn(),
        },
        command,
      ),
    ).resolves.toContain("Chat");
    await waitForMemoryIdle("chat");

    await close();
  });

  it("does not disguise invalid model JSON as a local summary", async () => {
    const { db, close } = await openTestDb();
    const messages = new MessagesRepo(db);
    const memory = new MemoriesRepo(db);
    const summaries = new SummariesRepo(db);
    await messages.save(message(1, now, "hello"));

    const summaryClient: ModelClient = {
      generateText: vi.fn(async () => "unused"),
      generateObject: vi.fn(async () => {
        throw new InvalidModelOutputError();
      }),
    };
    const memoryClient: ModelClient = {
      generateText: vi.fn(async () => "unused"),
      generateObject: vi.fn(async (_prompt, schema) =>
        schema.parse({ operations: [] }),
      ),
    };

    const command = {
      chatId: "chat",
      commandMessageId: 2,
      date: now + 1,
      mode: "count" as const,
      count: 1,
    };

    await expect(
      summarize(
        {
          memory,
          messages,
          summaries,
          models: new ModelGateway(summaryClient),
          memoryModels: new ModelGateway(memoryClient),
          onTrace: vi.fn(),
        },
        command,
      ),
    ).rejects.toBeInstanceOf(InvalidModelOutputError);

    expect(summaryClient.generateObject).toHaveBeenCalledTimes(1);
    await waitForMemoryIdle("chat");
    expect(memoryClient.generateObject).toHaveBeenCalledTimes(1);
    await close();
  });

  it("runs independent segments concurrently within the configured limit", async () => {
    const { db, close } = await openTestDb();
    const messages = new MessagesRepo(db);
    const memory = new MemoriesRepo(db);
    const summaries = new SummariesRepo(db);
    for (let index = 0; index < 4; index += 1) {
      await messages.save(message(index + 1, now + index * 31 * 60 * 1000));
    }

    let active = 0;
    let peak = 0;
    const summaryClient: ModelClient = {
      generateText: vi.fn(async () => "unused"),
      generateObject: vi.fn(async (_prompt, schema) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active -= 1;
        return schema.parse({ title: "Chat", events: [] });
      }),
    };
    const memoryClient: ModelClient = {
      generateText: vi.fn(async () => "unused"),
      generateObject: vi.fn(async (_prompt, schema) =>
        schema.parse({ operations: [] }),
      ),
    };
    const trace: SummaryWaterfallEvent[] = [];

    await summarize(
      {
        memory,
        messages,
        summaries,
        models: new ModelGateway(summaryClient),
        memoryModels: new ModelGateway(memoryClient),
        segmentConcurrency: 2,
        onTrace: (event) => trace.push(event),
      },
      {
        chatId: "chat",
        commandMessageId: 5,
        date: now + 4 * 31 * 60 * 1000,
        mode: "count",
        count: 4,
      },
    );

    expect(summaryClient.generateObject).toHaveBeenCalledTimes(4);
    expect(peak).toBe(2);
    expect(
      trace.filter((event) => event.stage === "segment.cache"),
    ).toHaveLength(4);
    expect(
      trace.filter(
        (event) =>
          event.stage === "segment.cache" && event.cacheStatus === "miss",
      ),
    ).toHaveLength(4);
    await waitForMemoryIdle("chat");
    await close();
  });

  it("returns the summary without waiting for background memory extraction", async () => {
    const { db, close } = await openTestDb();
    const messages = new MessagesRepo(db);
    const memory = new MemoriesRepo(db);
    const summaries = new SummariesRepo(db);
    await messages.save(message(1, now, "hello"));

    let releaseMemory!: () => void;
    const memoryGate = new Promise<void>((resolve) => {
      releaseMemory = resolve;
    });
    const summaryClient: ModelClient = {
      generateText: vi.fn(async () => "unused"),
      generateObject: vi.fn(async (_prompt, schema) =>
        schema.parse({ title: "Chat", events: [] }),
      ),
    };
    const memoryClient: ModelClient = {
      generateText: vi.fn(async () => "unused"),
      generateObject: vi.fn(async (_prompt, schema) => {
        await memoryGate;
        return schema.parse({ operations: [] });
      }),
    };

    await expect(
      summarize(
        {
          memory,
          messages,
          summaries,
          models: new ModelGateway(summaryClient),
          memoryModels: new ModelGateway(memoryClient),
          onTrace: vi.fn(),
        },
        {
          chatId: "chat",
          commandMessageId: 2,
          date: now + 1,
          mode: "count",
          count: 1,
        },
      ),
    ).resolves.toContain("Chat");

    releaseMemory();
    await waitForMemoryIdle("chat");
    await close();
  });
});

function message(
  id: number,
  date: number,
  text = `message ${id}`,
): ChatMessage {
  return {
    id,
    chatId: "chat",
    date,
    authorId: "alice",
    authorName: "Alice",
    text,
    kind: "text",
    isCommand: text.startsWith("/"),
  };
}

function reconstruction(statement: string, evidence: number[]) {
  return {
    title: "Chat",
    events: [
      {
        id: `m${evidence[0]}`,
        topicId: "greeting",
        topicTitle: "Greeting",
        speaker: "User",
        statement,
        speechAct: "assertion",
        literalness: "literal",
        commitment: "none",
        epistemicStatus: "claimed",
        settled: false,
        action: null,
        refersTo: [],
        stance: "neutral",
        semanticImportance: 0.7,
        confidence: 1,
        evidence,
      },
    ],
  };
}

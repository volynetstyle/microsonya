import { describe, expect, it, vi } from "vitest";
import {
  InvalidModelOutputError,
  SummarizationModelService,
  type ModelClient,
} from "../packages/model-gateway/src/index.js";
import {
  createMemoryState,
  createMemoryTable,
  findActiveMemory,
  materializeMemoryState,
  processChatDelta,
  retrieveRelevantMemory,
  type MemoryOpsModel,
} from "../packages/summarize/src/index.js";
import { renderMemorySummary } from "../experimental/tools/src/memoryView.js";
import type { ChatMessage, MemoryOp } from "../packages/shared/src/index.js";

describe("processChatDelta", () => {
  it("creates runtime-owned IDs and resolves an existing question incrementally", async () => {
    const prompts: string[] = [];
    const firstModel = model(
      [
        {
          type: "create",
          kind: "open_question",
          text: "Whether Redis is needed for caching",
          evidence: [501],
        },
      ],
      prompts,
    );

    const first = await processChatDelta(
      createMemoryState("chat"),
      [message(501, "Should we add Redis for caching?")],
      {
        model: firstModel,
        modelName: "test-model",
        now: () => 1_000,
      },
    );

    expect(first.state.items).toEqual([
      expect.objectContaining({
        id: "mem_000001",
        kind: "open_question",
        status: "active",
        evidence: [501],
      }),
    ]);
    expect(first.operations[0]).toMatchObject({
      id: "mop_000001",
      itemId: "mem_000001",
      createdItemId: "mem_000001",
      fromMessageId: 501,
      toMessageId: 501,
      model: "test-model",
      promptVersion: "memory-ops-v1",
      stateVersion: 1,
      createdAt: 1_000,
    });
    expect(first.operations[0]?.inputHash).toMatch(/^[a-f0-9]{64}$/);

    const second = await processChatDelta(
      first.state,
      [message(502, "No Redis. PostgreSQL remains sufficient.")],
      {
        model: model(
          [
            {
              type: "resolve",
              targetId: "mem_000001",
              text: "Redis will not be introduced; PostgreSQL remains sufficient",
              evidence: [502],
            },
          ],
          prompts,
        ),
        now: () => 2_000,
      },
    );

    expect(second.state.items[0]).toMatchObject({
      id: "mem_000001",
      status: "resolved",
      resolution: "Redis will not be introduced; PostgreSQL remains sufficient",
      evidence: [501, 502],
      lastUpdatedMessageId: 502,
    });
    expect(second.state.version).toBe(2);
    expect(second.state.processedThroughMessageId).toBe(502);
    expect(prompts[1]).toContain(
      "[mem_000001] kind=open_question status=active",
    );
    expect(prompts[1]).toContain(
      "[502] order=1 author=participant_1 replyTo=-",
    );
    expect(prompts[1]).not.toContain("Alice");
    expect(prompts[1]).not.toContain("2026-");
    expect(prompts[1]).toContain('"type": "resolve"');
    expect(prompts[1]).toContain('{"operations":[]}');
  });

  it("sorts and deduplicates new messages and never reprocesses its watermark", async () => {
    const extractMemoryOps = vi.fn(async () => [] as MemoryOp[]);
    const runtimeModel = { extractMemoryOps };
    const initial = createMemoryState("chat");

    const first = await processChatDelta(
      initial,
      [
        { ...message(3, "third"), replyToId: 2 },
        message(2, "second"),
        { ...message(3, "third, canonical duplicate"), replyToId: 2 },
      ],
      { model: runtimeModel },
    );

    expect(first.state.version).toBe(1);
    expect(first.state.processedThroughMessageId).toBe(3);
    expect(extractMemoryOps).toHaveBeenCalledTimes(1);
    const prompt = extractMemoryOps.mock.calls[0]?.[0] ?? "";
    expect(prompt.indexOf("[2] order=1")).toBeLessThan(
      prompt.indexOf("[3] order=2"),
    );
    expect(prompt).toContain("third, canonical duplicate");
    expect(prompt).toContain("[3] order=2 author=participant_1 replyTo=2");

    const second = await processChatDelta(
      first.state,
      [message(2), message(3)],
      {
        model: runtimeModel,
      },
    );
    expect(second.state).toBe(first.state);
    expect(second.operations).toEqual([]);
    expect(extractMemoryOps).toHaveBeenCalledTimes(1);
  });

  it("rejects invented identities and evidence, and reconciles known duplicates", async () => {
    const first = await processChatDelta(
      createMemoryState("chat"),
      [message(1, "We decided to use PostgreSQL")],
      {
        model: model([
          {
            type: "create",
            kind: "decision",
            text: "Use PostgreSQL",
            evidence: [1],
          },
        ]),
      },
    );

    const second = await processChatDelta(
      first.state,
      [message(2, "PostgreSQL remains the choice")],
      {
        model: model([
          {
            type: "create",
            kind: "decision",
            text: "  Use   PostgreSQL  ",
            evidence: [2],
          },
          { type: "retract", targetId: "mem_999999", evidence: [2] },
          { type: "support", targetId: "mem_000001", evidence: [999] },
        ]),
      },
    );

    expect(second.state.items).toHaveLength(1);
    expect(second.state.items[0]).toMatchObject({
      id: "mem_000001",
      status: "active",
      evidence: [1, 2],
    });
    expect(second.operations).toHaveLength(1);
    expect(second.operations[0]?.op).toEqual({
      type: "support",
      targetId: "mem_000001",
      evidence: [2],
    });
  });

  it("supersedes without silent overwrite and creates the replacement ID in runtime", async () => {
    const initial = await processChatDelta(
      createMemoryState("chat"),
      [message(10, "Use Redis")],
      {
        model: model([
          {
            type: "create",
            kind: "decision",
            text: "Use Redis",
            evidence: [10],
          },
        ]),
      },
    );

    const next = await processChatDelta(
      initial.state,
      [message(11, "Actually, keep PostgreSQL")],
      {
        model: model([
          {
            type: "supersede",
            targetId: "mem_000001",
            replacement: "Use PostgreSQL",
            evidence: [11],
          },
        ]),
      },
    );

    expect(next.state.items).toEqual([
      expect.objectContaining({
        id: "mem_000001",
        text: "Use Redis",
        status: "superseded",
        supersededBy: "mem_000002",
      }),
      expect.objectContaining({
        id: "mem_000002",
        text: "Use PostgreSQL",
        status: "active",
        evidence: [11],
      }),
    ]);
    expect(next.operations[0]).toMatchObject({
      itemId: "mem_000001",
      createdItemId: "mem_000002",
    });

    const log = [...initial.operations, ...next.operations];
    const rebuilt = materializeMemoryState("chat", log);
    expect(rebuilt.items).toEqual(next.state.items);
    expect(rebuilt.nextMemorySequence).toBe(next.state.nextMemorySequence);
    expect(rebuilt.nextOperationSequence).toBe(
      next.state.nextOperationSequence,
    );
    expect(renderMemorySummary(next.state)).toBe(
      ["Decisions", "- Use PostgreSQL"].join("\n"),
    );
  });

  it("advances across non-semantic messages without calling the model", async () => {
    const extractMemoryOps = vi.fn(async () => [] as MemoryOp[]);
    const sticker = { ...message(7, ""), kind: "sticker" as const };
    const state = await processChatDelta(createMemoryState("chat"), [sticker], {
      model: { extractMemoryOps },
    });

    expect(state.state.version).toBe(1);
    expect(state.state.processedThroughMessageId).toBe(7);
    expect(extractMemoryOps).not.toHaveBeenCalled();
  });
});

describe("MemoryTable", () => {
  it("indexes active identity, open questions, and token postings", () => {
    const state = {
      ...createMemoryState("chat"),
      items: [
        {
          id: "mem_000001",
          kind: "decision" as const,
          text: "Use PostgreSQL for persistence",
          status: "active" as const,
          evidence: [1],
          createdAtMessageId: 1,
          lastUpdatedMessageId: 1,
        },
        {
          id: "mem_000002",
          kind: "open_question" as const,
          text: "Who owns Redis caching?",
          status: "active" as const,
          evidence: [2],
          createdAtMessageId: 2,
          lastUpdatedMessageId: 2,
        },
      ],
    };
    const table = createMemoryTable(state);

    expect(
      findActiveMemory(table, "decision", " use postgresql for persistence "),
    ).toMatchObject({
      id: "mem_000001",
    });
    expect(
      retrieveRelevantMemory(table, [
        {
          ...message(3, "PostgreSQL replication"),
          order: 1,
          authorAlias: "participant_1",
        },
      ]),
    ).toEqual([
      expect.objectContaining({ id: "mem_000001" }),
      expect.objectContaining({ id: "mem_000002" }),
    ]);
  });
});

describe("SummarizationModelService.extractMemoryOps", () => {
  it("accepts typed operations and uses fail-closed [] for invalid output", async () => {
    const validClient: ModelClient = {
      generateText: vi.fn(async () => "unused"),
      generateObject: vi.fn(async (_prompt, schema) =>
        schema.parse({
          operations: [
            {
              type: "create",
              kind: "fact",
              text: "A grounded fact",
              evidence: [42],
            },
          ],
        }),
      ),
    };
    await expect(
      new SummarizationModelService(validClient).extractMemoryOps("prompt"),
    ).resolves.toEqual([
      {
        type: "create",
        kind: "fact",
        text: "A grounded fact",
        evidence: [42],
      },
    ]);

    const invalidClient: ModelClient = {
      generateText: vi.fn(async () => "unused"),
      generateObject: vi.fn(async () => {
        throw new InvalidModelOutputError();
      }),
    };
    await expect(
      new SummarizationModelService(invalidClient).extractMemoryOps("prompt"),
    ).resolves.toEqual([]);
  });
});

function model(operations: MemoryOp[], prompts: string[] = []): MemoryOpsModel {
  return {
    async extractMemoryOps(prompt) {
      prompts.push(prompt);
      return operations;
    },
  };
}

function message(id: number, text = `message ${id}`): ChatMessage {
  return {
    id,
    chatId: "chat",
    date: Date.UTC(2026, 7, 14, 12, id % 60),
    authorId: "alice-id",
    authorName: "Alice",
    text,
    kind: "text",
  };
}

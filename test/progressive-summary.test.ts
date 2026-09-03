import { describe, expect, it, vi } from "vitest";
import { OllamaClient } from "../packages/model/src/index.js";
import {
  asAuthorId,
  asChatId,
  asMessageId,
  asTimestampMs,
  createConversationWindow,
} from "../packages/shared/src/index.js";
import {
  createConversationSummarizer,
  ProgressiveOutputInvariantError,
  ProgressiveScheduler,
  ProgressiveSummarySession,
  SerializedPublisher,
  streamSummaryRun,
  type ProgressiveTransport,
} from "../packages/summarize/src/index.js";
import {
  TelegramEditableMessageTransport,
  TelegramPrivateDraftTransport,
} from "../packages/telegram/src/index.js";

function transport(overrides: Partial<ProgressiveTransport> = {}) {
  return {
    begin: vi.fn(async () => undefined),
    update: vi.fn(async (_text: string) => undefined),
    commit: vi.fn(async (_text: string) => undefined),
    fail: vi.fn(async () => undefined),
    ...overrides,
  } satisfies ProgressiveTransport;
}

describe("progressive summary runtime", () => {
  it("exposes model output as plain append-only chunks", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(
          `${JSON.stringify({ message: { content: "Перша " }, done: false })}\n${JSON.stringify({ message: { content: "частина." }, done: true })}\n`,
          { status: 200 },
        ),
    );
    const summarizer = createConversationSummarizer({
      ollama: new OllamaClient({ baseUrl: "http://model/api", fetch }),
    });
    const window = createConversationWindow([
      {
        id: asMessageId(1),
        chatId: asChatId("chat"),
        author: { id: asAuthorId("a"), label: "A" },
        time: asTimestampMs(1),
        parentId: null,
        text: "text",
      },
    ]);

    const chunks: string[] = [];
    for await (const chunk of summarizer.stream!(window)) chunks.push(chunk);
    expect(chunks).toEqual(["Перша ", "частина."]);
    const request = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
    expect(request).toMatchObject({
      stream: true,
      messages: [
        {
          role: "system",
          content: expect.stringContaining(
            "Return only the summary as plain text.",
          ),
        },
        {
          role: "user",
          content: expect.stringContaining("TRANSCRIPT_BEGIN"),
        },
      ],
    });
    expect(request).not.toHaveProperty("format");
  });

  it("coalesces desired snapshots while preserving serialized prefix order", async () => {
    let release!: () => void;
    const firstUpdate = new Promise<void>((resolve) => (release = resolve));
    const sent: string[] = [];
    const target = transport({
      update: vi.fn(async (text: string) => {
        sent.push(text);
        if (sent.length === 1) await firstUpdate;
      }),
    });
    const publisher = new SerializedPublisher(target);

    publisher.set("ABC");
    await Promise.resolve();
    publisher.set("ABCDEF");
    publisher.set("ABCDEFGHI");
    release();
    await publisher.flush();

    expect(sent).toEqual(["ABC", "ABCDEFGHI"]);
    expect(sent[1]!.startsWith(sent[0]!)).toBe(true);
  });

  it("rejects a rewrite rather than moving already visible meaning", () => {
    const publisher = new SerializedPublisher(transport());
    publisher.set("ABCDEF");
    expect(() => publisher.set("ABXDEF")).toThrow(
      ProgressiveOutputInvariantError,
    );
  });

  it("waits for the last update before the final commit", async () => {
    const calls: string[] = [];
    let release!: () => void;
    const pending = new Promise<void>((resolve) => (release = resolve));
    const target = transport({
      update: vi.fn(async (text: string) => {
        calls.push(`update:${text}`);
        await pending;
      }),
      commit: vi.fn(async (text: string) => {
        calls.push(`commit:${text}`);
      }),
    });
    const session = new ProgressiveSummarySession(target, undefined, {
      firstMaxWaitMs: 1_000,
      firstMinChars: 1,
      minIntervalMs: 1_000,
      minDeltaChars: 1,
      maxStalenessMs: 1_000,
    });

    await session.begin();
    session.append("final");
    const completion = session.complete();
    await Promise.resolve();
    expect(calls).toEqual(["update:final"]);
    release();
    await completion;
    expect(calls).toEqual(["update:final", "commit:final"]);
    expect(session.state).toBe("completed");
  });

  it("flushes immediately at completion even before cadence is due", async () => {
    const target = transport();
    const session = new ProgressiveSummarySession(target, undefined, {
      firstMaxWaitMs: 60_000,
      firstMinChars: 1_000,
      minIntervalMs: 60_000,
      minDeltaChars: 1_000,
      maxStalenessMs: 60_000,
    });
    await session.begin();
    session.append("short");
    await session.complete();
    expect(target.update).toHaveBeenCalledExactlyOnceWith("short");
    expect(target.commit).toHaveBeenCalledExactlyOnceWith("short");
  });

  it("orchestrates an AsyncIterable without coupling the producer to Telegram", async () => {
    async function* chunks() {
      yield "One ";
      yield "logical ";
      yield "summary";
    }
    const target = transport();
    const session = new ProgressiveSummarySession(target, undefined, {
      firstMaxWaitMs: 60_000,
      firstMinChars: 1_000,
      minIntervalMs: 60_000,
      minDeltaChars: 1_000,
      maxStalenessMs: 60_000,
    });

    await expect(streamSummaryRun(chunks(), session)).resolves.toBe(
      "One logical summary",
    );
    expect(target.begin).toHaveBeenCalledOnce();
    expect(target.commit).toHaveBeenCalledExactlyOnceWith(
      "One logical summary",
    );
  });

  it("publishes the first output when its maximum wait expires", () => {
    vi.useFakeTimers();
    try {
      const publish = vi.fn();
      const scheduler = new ProgressiveScheduler(
        {
          firstMaxWaitMs: 300,
          firstMinChars: 20,
          minIntervalMs: 900,
          minDeltaChars: 24,
          maxStalenessMs: 1_800,
        },
        publish,
        () => Date.now(),
      );
      scheduler.notify("tiny");
      vi.advanceTimersByTime(299);
      expect(publish).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(publish).toHaveBeenCalledExactlyOnceWith("tiny");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Telegram progressive transports", () => {
  it("uses one non-stoppable draft id in private chat and commits normally", async () => {
    const call = vi.fn(async (method: string) =>
      method === "sendMessage" ? { result: { message_id: 8 } } : { ok: true },
    );
    const target = new TelegramPrivateDraftTransport({ call }, "42", 7);
    await target.begin();
    await target.update("Підсумок");
    await target.commit("Підсумок");

    expect(call.mock.calls).toEqual([
      [
        "sendMessageDraft",
        { chat_id: "42", draft_id: 7, text: "", can_stop: false },
      ],
      [
        "sendMessageDraft",
        { chat_id: "42", draft_id: 7, text: "Підсумок", can_stop: false },
      ],
      ["sendMessage", { chat_id: "42", text: "Підсумок" }],
    ]);
  });

  it("creates and then edits one group artifact, removing the cursor at commit", async () => {
    const call = vi.fn(async (method: string) =>
      method === "sendMessage" ? { result: { message_id: 99 } } : { ok: true },
    );
    const target = new TelegramEditableMessageTransport(
      { call },
      { chatId: "-100", commandMessageId: 12, messageThreadId: 3 },
    );
    await target.begin();
    await target.update("ABC");
    await target.update("ABCDEF");
    await target.commit("ABCDEF");

    expect(call).toHaveBeenNthCalledWith(2, "sendMessage", {
      chat_id: "-100",
      message_thread_id: 3,
      text: "ABC ▍",
      reply_parameters: { message_id: 12 },
    });
    expect(call).toHaveBeenNthCalledWith(3, "editMessageText", {
      chat_id: "-100",
      message_id: 99,
      text: "ABCDEF ▍",
    });
    expect(call).toHaveBeenNthCalledWith(4, "editMessageText", {
      chat_id: "-100",
      message_id: 99,
      text: "ABCDEF",
    });
  });
});

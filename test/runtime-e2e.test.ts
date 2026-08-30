import { describe, expect, it, vi } from "vitest";
import {
  asAuthorId,
  asChatId,
  asMessageId,
  asSummaryId,
  asTimestampMs,
  type ChatMessage,
  type SummaryCommand,
  type SummaryDecision,
  type SummaryRun,
} from "../packages/shared/src/index.js";
import { createSummarizer } from "../packages/summarize/src/index.js";
import {
  InMemoryMessagesRepo,
  InMemorySummariesRepo,
} from "../apps/telegram/bot/src/storage.js";

describe("runtime summary invariants", () => {
  it("does not persist or advance after a provider failure", async () => {
    const saveRun = vi.fn();
    const summarizer = createSummarizer({
      messages: {
        listByChat: async () => [message(1, "Deploy moved to Thursday.")],
      },
      summaries: { findLastRun: async () => undefined, saveRun },
      classifier: {
        classify: async () => {
          throw new DOMException("Provider timed out", "TimeoutError");
        },
      },
      conversationSummarizer: { summarize: vi.fn() },
    });

    await expect(summarizer.process(command(10))).rejects.toMatchObject({
      name: "TimeoutError",
    });
    expect(saveRun).not.toHaveBeenCalled();
  });

  it("stores only the latest edit for one Telegram message id", async () => {
    const messages = new InMemoryMessagesRepo();
    const summaries = new InMemorySummariesRepo();
    await messages.save(message(200, "Deploy буде о 18:00."));
    await messages.save(message(200, "Deploy переносимо на завтра."));

    await expect(messages.listByChat(asChatId("chat"))).resolves.toMatchObject([
      { id: 200, text: "Deploy переносимо на завтра." },
    ]);

    let observedText = "";
    const summarizer = createSummarizer({
      messages,
      summaries,
      classifier: {
        classify: async (window) => {
          observedText = window.messages.map(({ text }) => text).join("\n");
          return decision("SKIP_NO_VALUE");
        },
      },
      conversationSummarizer: { summarize: vi.fn() },
      createSummaryId: () => asSummaryId("edited-skip"),
      now: () => asTimestampMs(300_000_001),
    });

    await summarizer.process(command(201));
    expect(observedText).toBe("Deploy переносимо на завтра.");
    await expect(
      summaries.findLastRun(asChatId("chat")),
    ).resolves.toMatchObject({
      action: "SKIP_NO_VALUE",
      covers: { lastId: 200 },
    });
  });

  it("commits one result for concurrent summary commands in the same chat", async () => {
    const runs: SummaryRun[] = [];
    const classifier = vi.fn(async () => {
      await Promise.resolve();
      return {
        action: "SUMMARIZE" as const,
        evidence: { source: "model" as const, model: "test" },
      };
    });
    const summarizer = createSummarizer({
      messages: {
        listByChat: async () => [
          message(1, "Deploy завершили."),
          message(2, "Міграція успішна."),
        ],
      },
      summaries: {
        findLastRun: async () => runs.at(-1),
        saveRun: async (run) => {
          runs.push(run);
        },
      },
      classifier: { classify: classifier },
      conversationSummarizer: {
        summarize: async () => ({ text: "Deploy і міграцію завершено." }),
      },
      createSummaryId: () => asSummaryId("summary"),
      now: () => asTimestampMs(300_000_000),
    });

    const results = await Promise.all([
      summarizer.process(command(10)),
      summarizer.process(command(11)),
    ]);

    expect(runs).toHaveLength(1);
    expect(classifier).toHaveBeenCalledOnce();
    expect(
      results.filter((result) => result?.kind === "summarized"),
    ).toHaveLength(1);
    expect(results).toContain(null);
    expect(runs[0]?.covers.lastId).toBe(2);
  });

  it("makes a parent across the checkpoint available as reply context without advancing on DEFER", async () => {
    const messages = new InMemoryMessagesRepo();
    const summaries = new InMemorySummariesRepo();
    await messages.save(
      message(100, "Backend deploy is blocked by migration 42."),
    );
    await summaries.saveRun({
      id: asSummaryId("previous"),
      chatId: asChatId("chat"),
      commandMessageId: asMessageId(101),
      createdAt: asTimestampMs(299_999_500),
      covers: { firstId: asMessageId(100), lastId: asMessageId(100), count: 1 },
      mode: "recent",
      status: "summarized",
      action: "SUMMARIZE",
      finalText: "Deploy blocked by migration 42.",
    });
    await messages.save(
      message(117, "Міграцію вже закінчили, deploy можна запускати.", 100),
    );

    const observedWindows: ChatMessage[][] = [];
    const summarizer = createSummarizer({
      messages,
      summaries,
      classifier: {
        classify: async (window) => {
          observedWindows.push([...window.messages]);
          return decision("DEFER_COMPACT");
        },
      },
      conversationSummarizer: { summarize: vi.fn() },
    });

    await expect(summarizer.process(command(118))).resolves.toMatchObject({
      kind: "deferred",
      reason: "DEFER_COMPACT",
    });
    expect(observedWindows[0]).toMatchObject([
      { id: 100, parentId: null },
      { id: 117, parentId: 100 },
    ]);
    await expect(
      summaries.findLastRun(asChatId("chat")),
    ).resolves.toMatchObject({
      id: "previous",
      covers: { lastId: 100 },
    });
  });
});

function decision(action: SummaryDecision["action"]): SummaryDecision {
  return { action, evidence: { source: "model", model: "test" } };
}

function command(id: number): SummaryCommand {
  return {
    chatId: asChatId("chat"),
    commandMessageId: asMessageId(id),
    date: asTimestampMs(300_000_000),
    mode: "recent",
  };
}

function message(
  id: number,
  text: string,
  parentId: number | null = null,
): ChatMessage {
  return {
    id: asMessageId(id),
    chatId: asChatId("chat"),
    author: { id: asAuthorId("author"), label: "Olia" },
    time: asTimestampMs(299_999_000 + id),
    parentId: parentId === null ? null : asMessageId(parentId),
    text,
  };
}

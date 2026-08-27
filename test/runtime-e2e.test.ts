import { describe, expect, it, vi } from "vitest";
import {
  asAuthorId,
  asChatId,
  asMessageId,
  asSummaryId,
  asTimestampMs,
  type ChatMessage,
  type SummaryCommand,
  type SummaryRun,
} from "../packages/shared/src/index.js";
import { createSummarizer } from "../packages/summarize/src/index.js";
import { InMemoryMessagesRepo } from "../apps/telegram/bot/src/storage.js";

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
    await messages.save(message(200, "Deploy буде о 18:00."));
    await messages.save(message(200, "Deploy переносимо на завтра."));

    await expect(messages.listByChat(asChatId("chat"))).resolves.toMatchObject([
      { id: 200, text: "Deploy переносимо на завтра." },
    ]);
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
});

function command(id: number): SummaryCommand {
  return {
    chatId: asChatId("chat"),
    commandMessageId: asMessageId(id),
    date: asTimestampMs(300_000_000),
    mode: "recent",
  };
}

function message(id: number, text: string): ChatMessage {
  return {
    id: asMessageId(id),
    chatId: asChatId("chat"),
    author: { id: asAuthorId("author"), label: "Olia" },
    time: asTimestampMs(299_999_000 + id),
    parentId: null,
    text,
  };
}

import { describe, expect, it, vi } from "vitest";
import { createSummarizer } from "../packages/summarize/src/index.js";

describe("summarizer 0.1", () => {
  it("summarizes new messages with one model call and advances the cursor", async () => {
    const saveRun = vi.fn(async () => undefined);
    const generate = vi.fn(async () => ({
      title: "Рішення",
      summary: "Команда погодила реліз у п’ятницю.",
    }));
    const summarizer = createSummarizer({
      messages: {
        listByChat: async () => [
          {
            id: 1,
            chatId: "chat",
            date: 100,
            authorId: "1",
            authorName: "Оля",
            text: "Реліз у п’ятницю",
            kind: "text",
          },
          {
            id: 2,
            chatId: "chat",
            date: 101,
            authorId: "2",
            authorName: "Макс",
            text: "/summarize",
            kind: "text",
            isCommand: true,
          },
        ],
      },
      summaries: { findLastRun: async () => undefined, saveRun },
      model: { generate: generate as never },
    });

    await expect(
      summarizer.summarize({
        chatId: "chat",
        commandMessageId: 2,
        date: 200,
        mode: "recent",
      }),
    ).resolves.toBe("Команда погодила реліз у п’ятницю.");
    expect(generate).toHaveBeenCalledOnce();
    expect(saveRun).toHaveBeenCalledWith(
      expect.objectContaining({
        toMessageId: 1,
        finalText: "Команда погодила реліз у п’ятницю.",
      }),
    );
  });

  it("returns null without calling the model when there are no new messages", async () => {
    const generate = vi.fn();
    const summarizer = createSummarizer({
      messages: { listByChat: async () => [] },
      summaries: { findLastRun: async () => undefined, saveRun: vi.fn() },
      model: { generate: generate as never },
    });
    await expect(
      summarizer.summarize({
        chatId: "chat",
        commandMessageId: 1,
        date: 200,
        mode: "recent",
      }),
    ).resolves.toBeNull();
    expect(generate).not.toHaveBeenCalled();
  });
});

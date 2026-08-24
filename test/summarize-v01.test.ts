import { describe, expect, it, vi } from "vitest";
import { createSummarizer } from "../packages/summarize/src/index.js";

describe("summarizer 0.1", () => {
  it("summarizes new messages with one Ollama chat call and advances the cursor", async () => {
    const saveRun = vi.fn(async () => undefined);
    const chat = vi.fn(async () => ({
      message: { content: JSON.stringify({ summary: "Release is Friday." }) },
    }));
    const summarizer = createSummarizer({
      messages: {
        listByChat: async () => [
          {
            id: 1,
            chatId: "chat",
            date: 100,
            authorId: "1",
            authorName: "Olia",
            text: "Release is Friday",
            kind: "text",
          },
          {
            id: 2,
            chatId: "chat",
            date: 101,
            authorId: "2",
            authorName: "Max",
            text: "/summarize",
            kind: "text",
            isCommand: true,
          },
        ],
      },
      summaries: { findLastRun: async () => undefined, saveRun },
      ollama: { chat: chat as never },
    });
    await expect(
      summarizer.summarize({
        chatId: "chat",
        commandMessageId: 2,
        date: 200,
        mode: "recent",
      }),
    ).resolves.toBe("Release is Friday.");
    expect(chat).toHaveBeenCalledOnce();
    expect(chat).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-oss:120b-cloud",
        think: "low",
        format: "json",
        stream: false,
        options: expect.objectContaining({ num_predict: 2_500 }),
      }),
      { signal: undefined },
    );
    expect(saveRun).toHaveBeenCalledWith(
      expect.objectContaining({
        toMessageId: 1,
        finalText: "Release is Friday.",
      }),
    );
  });

  it("returns null without calling Ollama when there are no new messages", async () => {
    const chat = vi.fn();
    const summarizer = createSummarizer({
      messages: { listByChat: async () => [] },
      summaries: { findLastRun: async () => undefined, saveRun: vi.fn() },
      ollama: { chat: chat as never },
    });
    await expect(
      summarizer.summarize({
        chatId: "chat",
        commandMessageId: 1,
        date: 200,
        mode: "recent",
      }),
    ).resolves.toBeNull();
    expect(chat).not.toHaveBeenCalled();
  });
});

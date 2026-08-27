import { describe, expect, it, vi } from "vitest";
import { createMessageHandler } from "../apps/telegram/bot/src/telegramHandlers.js";

describe("Telegram message handler reply boundary", () => {
  it("rethrows ingestion errors for ordinary messages without replying", async () => {
    const failure = new Error("storage unavailable");
    const reply = vi.fn();
    const handler = createMessageHandler({
      messages: { save: vi.fn(async () => Promise.reject(failure)) },
      summarizer: { process: vi.fn() },
    });
    const ctx = contextFor("hello", reply);

    await expect(handler(ctx as never)).rejects.toBe(failure);
    expect(reply).not.toHaveBeenCalled();
  });

  it("turns a recognized summary failure into one final reply", async () => {
    const reply = vi.fn(async () => undefined);
    const save = vi.fn(async () => undefined);
    const process = vi.fn(async () => {
      throw new Error("model failed");
    });
    const handler = createMessageHandler({
      messages: { save },
      summarizer: { process },
    });
    const ctx = contextFor("/summarize", reply, [
      { type: "bot_command", offset: 0, length: 10 },
    ]);

    await handler(ctx as never);
    expect(process).toHaveBeenCalledOnce();
    expect(save).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledOnce();
    expect(reply).toHaveBeenCalledWith(
      "Не вдалося підготувати підсумок. Я вже зафіксував помилку. Спробуй ще раз трохи пізніше.",
    );
  });

  it("does not disguise or swallow final delivery failures", async () => {
    const failure = new Error("Telegram unavailable");
    const reply = vi.fn(async () => Promise.reject(failure));
    const handler = createMessageHandler({
      messages: { save: vi.fn(async () => undefined) },
      summarizer: {
        process: vi.fn(async () => ({
          kind: "skipped" as const,
          reason: "SKIP_NO_VALUE" as const,
        })),
      },
    });
    const ctx = contextFor("/summarize", reply, [
      { type: "bot_command", offset: 0, length: 10 },
    ]);

    await expect(handler(ctx as never)).rejects.toBe(failure);
    expect(reply).toHaveBeenCalledOnce();
  });
});

function contextFor(
  text: string,
  reply: ReturnType<typeof vi.fn>,
  entities?: { type: "bot_command"; offset: number; length: number }[],
) {
  const message = {
    message_id: 10,
    date: 100,
    text,
    entities,
    chat: { id: -1, type: "group" },
    from: { id: 1, first_name: "User" },
  };
  return { message, chat: message.chat, me: "bot", reply };
}

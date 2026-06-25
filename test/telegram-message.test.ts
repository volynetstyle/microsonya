import { describe, expect, it } from "vitest";
import {
  isForwardedMessage,
  toChatMessage,
  type TelegramMessageLike,
} from "../apps/telegram/bot/src/telegram/message.js";

describe("telegram message mapping", () => {
  it("uses forwarded author and date when Telegram exposes them", () => {
    const message = toChatMessage({
      message_id: 12,
      date: 1_800,
      text: "forwarded text",
      chat: { id: 42 },
      from: { id: 7, first_name: "Receiver" },
      forward_origin: {
        type: "user",
        date: 1_700,
        sender_user: { id: 99, first_name: "Alice", last_name: "Source" },
      },
    });

    expect(message).toMatchObject({
      id: 12,
      chatId: "42",
      date: 1_700_000,
      authorId: "99",
      authorName: "Alice Source",
      text: "forwarded text",
      kind: "text",
      isCommand: false,
    });
  });

  it("does not treat forwarded slash text as a command", () => {
    const forwardedCommand: TelegramMessageLike = {
      message_id: 13,
      date: 1_800,
      text: "/summarize",
      chat: { id: 42 },
      from: { id: 7, first_name: "Receiver" },
      forward_sender_name: "Hidden",
      forward_date: 1_700,
    };

    expect(isForwardedMessage(forwardedCommand)).toBe(true);
    expect(toChatMessage(forwardedCommand).isCommand).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { parseTelegramChatMessageUpdate } from "../packages/telegram/src/index.js";

describe("telegram message mapping", () => {
  it("uses forwarded author but destination time for window chronology", () => {
    const message = parseTelegramChatMessageUpdate({
      message: {
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
      },
    });

    expect(message).toMatchObject({
      id: 12,
      chatId: "42",
      time: 1_800_000,
      author: {
        id: "99",
        label: "Alice Source",
      },
      parentId: null,
      text: "forwarded text",
    });
    expect(Object.isFrozen(message)).toBe(true);
    expect(Object.isFrozen(message?.author)).toBe(true);
  });

  it("keeps forwarded commands out of semantic evidence", () => {
    const forwardedCommand = {
      message_id: 13,
      date: 1_800,
      text: "/summarize",
      chat: { id: 42 },
      from: { id: 7, first_name: "Receiver" },
      forward_sender_name: "Hidden",
      forward_date: 1_700,
      entities: [{ type: "bot_command", offset: 0, length: 10 }],
    };

    expect(
      parseTelegramChatMessageUpdate({ message: forwardedCommand }),
    ).toBeUndefined();
  });

  it("keeps this bot's own replies out of semantic evidence", () => {
    expect(
      parseTelegramChatMessageUpdate(
        {
          message: {
            message_id: 14,
            date: 1_800,
            text: "Previous classifier verdict",
            chat: { id: 42 },
            forward_origin: {
              type: "user",
              sender_user: { id: 99, first_name: "Microsonya" },
            },
          },
        },
        "99",
      ),
    ).toBeUndefined();
  });

  it("does not turn non-forwarded Telegram commands into chat messages", () => {
    expect(
      parseTelegramChatMessageUpdate({
        message: {
          message_id: 13,
          date: 1_800,
          text: "/summarize",
          chat: { id: 42 },
          entities: [{ type: "bot_command", offset: 0, length: 10 }],
        },
      }),
    ).toBeUndefined();
  });

  it("maps captions as text and ignores uncaptioned media", () => {
    expect(
      parseTelegramChatMessageUpdate({
        message: {
          message_id: 14,
          date: 1_800,
          caption: "photo caption",
          photo: [{}],
          chat: { id: 42 },
        },
      })?.text,
    ).toBe("photo caption");

    expect(
      parseTelegramChatMessageUpdate({
        message: {
          message_id: 15,
          date: 1_800,
          photo: [{}],
          chat: { id: 42 },
        },
      }),
    ).toBeUndefined();
  });

  it("maps an explicit parent and canonical null when none exists", () => {
    expect(
      parseTelegramChatMessageUpdate({
        message: {
          message_id: 16,
          date: 1_800,
          text: "reply",
          chat: { id: 42 },
          reply_to_message: { message_id: 9 },
        },
      })?.parentId,
    ).toBe(9);

    expect(
      parseTelegramChatMessageUpdate({
        message: {
          message_id: 17,
          date: 1_801,
          text: "root",
          chat: { id: 42 },
        },
      })?.parentId,
    ).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import {
  parseTelegramChatMessageUpdate,
  parseTelegramMessageUpdate,
} from "../src";

describe("telegram message mapping", () => {
  it("accepts ephemeral message_id zero at the Telegram boundary only", () => {
    const update = {
      update_id: 0,
      message: {
        message_id: 0,
        ephemeral_message_id: 7,
        date: 1_800,
        text: "ephemeral",
        chat: { id: -42, type: "supergroup" },
        from: { id: 7, first_name: "Alice" },
      },
    };

    expect(parseTelegramMessageUpdate(update)?.messageId).toBe(0);
    expect(parseTelegramChatMessageUpdate(update)).toBeUndefined();
  });

  it("prefers sender_chat over Telegram's compatibility from user", () => {
    const message = parseTelegramChatMessageUpdate({
      update_id: 9,
      message: {
        message_id: 18,
        date: 1_802,
        text: "anonymous admin",
        chat: { id: -42, type: "supergroup", title: "Destination" },
        sender_chat: { id: -99, title: "Editorial team" },
        from: { id: 1087968824, first_name: "GroupAnonymousBot" },
      },
    });

    expect(message?.author).toEqual({ id: "-99", label: "Editorial team" });
  });
  it("uses forwarded author but destination time for window chronology", () => {
    const message = parseTelegramChatMessageUpdate({
      update_id: 1,
      message: {
        message_id: 12,
        date: 1_800,
        text: "forwarded text",
        chat: { id: 42, type: "group" },
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
      chat: { id: 42, type: "group" },
      from: { id: 7, first_name: "Receiver" },
      forward_origin: {
        type: "hidden_user",
        date: 1_700,
        sender_user_name: "Hidden",
      },
      entities: [{ type: "bot_command", offset: 0, length: 10 }],
    };

    expect(
      parseTelegramChatMessageUpdate({
        update_id: 2,
        message: forwardedCommand,
      }),
    ).toBeUndefined();
  });

  it("keeps this bot's own replies out of semantic evidence", () => {
    expect(
      parseTelegramChatMessageUpdate(
        {
          update_id: 3,
          message: {
            message_id: 14,
            date: 1_800,
            text: "Previous classifier verdict",
            chat: { id: 42, type: "group" },
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
        update_id: 4,
        message: {
          message_id: 13,
          date: 1_800,
          text: "/summarize",
          chat: { id: 42, type: "group" },
          entities: [{ type: "bot_command", offset: 0, length: 10 }],
        },
      }),
    ).toBeUndefined();
  });

  it("maps captions as text and ignores uncaptioned media", () => {
    expect(
      parseTelegramChatMessageUpdate({
        update_id: 5,
        message: {
          message_id: 14,
          date: 1_800,
          caption: "photo caption",
          photo: [{}],
          chat: { id: 42, type: "group" },
        },
      })?.text,
    ).toBe("photo caption");

    expect(
      parseTelegramChatMessageUpdate({
        update_id: 6,
        message: {
          message_id: 15,
          date: 1_800,
          photo: [{}],
          chat: { id: 42, type: "group" },
        },
      }),
    ).toBeUndefined();
  });

  it("maps an explicit parent and canonical null when none exists", () => {
    expect(
      parseTelegramChatMessageUpdate({
        update_id: 7,
        message: {
          message_id: 16,
          date: 1_800,
          text: "reply",
          chat: { id: 42, type: "group" },
          reply_to_message: { message_id: 9 },
        },
      })?.parentId,
    ).toBe(9);

    expect(
      parseTelegramChatMessageUpdate({
        update_id: 8,
        message: {
          message_id: 17,
          date: 1_801,
          text: "root",
          chat: { id: 42, type: "group" },
        },
      })?.parentId,
    ).toBeNull();
  });
});

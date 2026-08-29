import { describe, expect, it } from "vitest";
import { parseTelegramChatMessageUpdate } from "../packages/telegram/src/index.js";

describe("canonical Cloudflare Telegram ingress", () => {
  it("maps an ordinary update to the canonical ChatMessage", () => {
    expect(
      parseTelegramChatMessageUpdate({
        update_id: 1,
        message: {
          message_id: 12,
          date: 1_800,
          text: "Deploy at 18:00",
          chat: { id: -42, type: "supergroup" },
          from: { id: 7, first_name: "Alice", last_name: "Smith" },
          reply_to_message: { message_id: 11 },
        },
      }),
    ).toEqual({
      id: 12,
      chatId: "-42",
      author: { id: "7", label: "Alice Smith" },
      time: 1_800_000,
      parentId: 11,
      text: "Deploy at 18:00",
    });
  });

  it("never persists slash commands as semantic conversation input", () => {
    expect(
      parseTelegramChatMessageUpdate({
        update_id: 2,
        message: {
          message_id: 13,
          date: 1_801,
          text: "/summary today",
          chat: { id: -42 },
          from: { id: 7, first_name: "Alice" },
        },
      }),
    ).toBeUndefined();
  });

  it("preserves forwarded provenance while using destination chronology", () => {
    expect(
      parseTelegramChatMessageUpdate({
        update_id: 3,
        message: {
          message_id: 14,
          date: 1_900,
          text: "Forwarded decision",
          chat: { id: -42 },
          from: { id: 7, first_name: "Receiver" },
          forward_origin: {
            type: "user",
            date: 1_000,
            sender_user: { id: 99, first_name: "Source" },
          },
        },
      }),
    ).toMatchObject({
      time: 1_900_000,
      author: { id: "99", label: "Source" },
    });
  });
});

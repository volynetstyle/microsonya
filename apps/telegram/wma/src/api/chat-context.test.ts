import { describe, expect, it } from "vitest";
import { getTelegramChatTitle } from "./chat-context";
import type { TelegramWebApp } from "./types";

describe("getTelegramChatTitle", () => {
  it("returns and normalizes the chat title shared by Telegram", () => {
    expect(
      getTelegramChatTitle({
        initDataUnsafe: { chat: { title: "  Product chat  " } },
      } as TelegramWebApp),
    ).toBe("Product chat");
  });

  it("does not invent a title without chat access", () => {
    expect(getTelegramChatTitle(undefined)).toBeUndefined();
    expect(
      getTelegramChatTitle({ initDataUnsafe: {} } as TelegramWebApp),
    ).toBeUndefined();
  });
});

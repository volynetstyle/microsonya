import { describe, expect, it } from "vitest";
import { createStorage } from "../apps/telegram/bot/src/storage.js";

describe("in-memory storage", () => {
  it("stores messages by chat in message-id order", async () => {
    const storage = createStorage();

    await storage.messages.save({
      id: 2,
      chatId: "chat-a",
      date: 2,
      authorId: "author",
      authorName: "Author",
      text: "second",
      kind: "text",
    });
    await storage.messages.save({
      id: 1,
      chatId: "chat-a",
      date: 1,
      authorId: "author",
      authorName: "Author",
      text: "first",
      kind: "text",
    });

    await expect(storage.messages.listByChat("chat-a")).resolves.toMatchObject([
      { id: 1, text: "first" },
      { id: 2, text: "second" },
    ]);
  });
});

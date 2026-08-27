import { describe, expect, it } from "vitest";
import {
  asAuthorId,
  asChatId,
  asMessageId,
  asSummaryId,
  asTimestampMs,
} from "../packages/shared/src/index.js";
import { createStorage } from "../apps/telegram/bot/src/storage.js";

describe("in-memory storage", () => {
  it("stores messages by chat in message-id order", async () => {
    const storage = createStorage();
    const chatId = asChatId("chat-a");

    await storage.messages.save({
      id: asMessageId(2),
      chatId,
      time: asTimestampMs(2),
      author: { id: asAuthorId("author"), label: "Author" },
      parentId: null,
      text: "second",
    });
    await storage.messages.save({
      id: asMessageId(1),
      chatId,
      time: asTimestampMs(1),
      author: { id: asAuthorId("author"), label: "Author" },
      parentId: null,
      text: "first",
    });

    await expect(storage.messages.listByChat(chatId)).resolves.toMatchObject([
      { id: 1, text: "first" },
      { id: 2, text: "second" },
    ]);
  });

  it("deep-copies and freezes stored messages", async () => {
    const storage = createStorage();
    const chatId = asChatId("chat-a");
    const author = { id: asAuthorId("author"), label: "Before" };

    await storage.messages.save({
      id: asMessageId(1),
      chatId,
      time: asTimestampMs(1),
      author,
      parentId: null,
      text: "immutable",
    });
    author.label = "After";

    const messages = await storage.messages.listByChat(chatId);
    expect(messages[0]?.author.label).toBe("Before");
    expect(Object.isFrozen(messages)).toBe(true);
    expect(Object.isFrozen(messages[0])).toBe(true);
    expect(Object.isFrozen(messages[0]?.author)).toBe(true);

    expect(() => Array.prototype.pop.call(messages)).toThrow();
    const reread = await storage.messages.listByChat(chatId);
    expect(reread[0]?.id).toBe(1);
  });

  it("uses summarized and skipped runs as terminal history cursors", async () => {
    const storage = createStorage();
    const chatId = asChatId("chat-a");
    const covers = {
      firstId: asMessageId(5),
      lastId: asMessageId(9),
      count: 2,
    };

    await storage.summaries.saveRun({
      id: asSummaryId("summary-1"),
      chatId,
      commandMessageId: asMessageId(10),
      createdAt: asTimestampMs(100),
      covers,
      mode: "recent",
      status: "summarized",
      action: "SUMMARIZE",
      finalText: "summary",
    });
    covers.count = 99;

    const run = await storage.summaries.findLastRun(chatId);
    expect(run?.covers).toEqual({ firstId: 5, lastId: 9, count: 2 });
    expect(Object.isFrozen(run)).toBe(true);
    expect(Object.isFrozen(run?.covers)).toBe(true);

    await storage.summaries.saveRun({
      id: asSummaryId("skip-2"),
      chatId,
      commandMessageId: asMessageId(11),
      createdAt: asTimestampMs(101),
      covers: {
        firstId: asMessageId(10),
        lastId: asMessageId(10),
        count: 1,
      },
      mode: "recent",
      status: "skipped",
      action: "SKIP_REACTIONS",
      finalText: "skipped",
    });

    await expect(storage.summaries.findLastRun(chatId)).resolves.toMatchObject({
      status: "skipped",
      covers: { lastId: 10, count: 1 },
    });
  });
});

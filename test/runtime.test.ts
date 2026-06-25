import { describe, expect, it, vi } from "vitest";
import { MessagesRepo, SummariesRepo } from "../packages/db/src/index.js";
import { ModelGateway, type ModelClient } from "../packages/model-gateway/src/index.js";
import { segmentMessages, selectSummaryWindow, summarize } from "../packages/summarize/src/index.js";
import type { ChatMessage } from "../packages/shared/src/index.js";
import { openTestDb } from "./dbTestUtils.js";

const now = new Date("2026-06-24T12:00:00.000Z").getTime();

describe("selectSummaryWindow", () => {
  it("selects recent text messages after the last summary within 12 hours", () => {
    const messages = [
      message(1, now - 13 * 60 * 60 * 1000),
      message(2, now - 60_000),
      message(3, now)
    ];

    const selected = selectSummaryWindow(
      { chatId: "chat", commandMessageId: 4, date: now, mode: "recent" },
      messages,
      {
        id: "run",
        chatId: "chat",
        commandMessageId: 2,
        createdAt: now,
        fromMessageId: 1,
        toMessageId: 2,
        mode: "recent",
        status: "ok",
        finalText: "done"
      }
    );

    expect(selected.map((item) => item.id)).toEqual([3]);
  });

  it("supports explicit count mode", () => {
    const selected = selectSummaryWindow(
      { chatId: "chat", commandMessageId: 5, date: now, mode: "count", count: 2 },
      [message(1, now), message(2, now), message(3, now)]
    );

    expect(selected.map((item) => item.id)).toEqual([2, 3]);
  });

  it("excludes command messages from summaries", () => {
    const selected = selectSummaryWindow(
      { chatId: "chat", commandMessageId: 3, date: now, mode: "count", count: 3 },
      [message(1, now, "hello"), message(2, now, "/summarize"), message(3, now, "world")]
    );

    expect(selected.map((item) => item.text)).toEqual(["hello", "world"]);
  });
});

describe("segmentMessages", () => {
  it("splits messages after a 30 minute gap", () => {
    const segments = segmentMessages([message(1, now), message(2, now + 31 * 60 * 1000)]);

    expect(segments).toHaveLength(2);
    expect(segments[0]?.reason).toBe("time_gap");
  });
});

describe("summarize", () => {
  it("caches segment summaries and reuses them on repeated count summaries", async () => {
    const { db, close } = await openTestDb();
    const messages = new MessagesRepo(db);
    const summaries = new SummariesRepo(db);
    await messages.save(message(1, now, "hello"));
    await messages.save(message(2, now + 1, "world"));

    const client: ModelClient = {
      complete: vi.fn(async (_prompt, responseFormat) =>
        responseFormat === "json"
          ? JSON.stringify({
              title: "Chat",
              summary: ["hello world"],
              decisions: [],
              openQuestions: [],
              jokes: [],
              mentionedPeople: ["Alice"],
              importance: 1
            })
          : "summary"
      )
    };

    const command = { chatId: "chat", commandMessageId: 3, date: now + 2, mode: "count" as const, count: 2 };

    await summarize({ messages, summaries, models: new ModelGateway(client) }, command);
    await summarize({ messages, summaries, models: new ModelGateway(client) }, command);

    expect(client.complete).toHaveBeenCalledTimes(3);
    await close();
  });
});

function message(id: number, date: number, text = `message ${id}`): ChatMessage {
  return {
    id,
    chatId: "chat",
    date,
    authorId: "alice",
    authorName: "Alice",
    text,
    kind: "text",
    isCommand: text.startsWith("/")
  };
}

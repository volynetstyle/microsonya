import { afterEach, describe, expect, it } from "vitest";
import { MessagesRepo, SummariesRepo } from "../packages/db/src/index.js";
import type { ChatMessage, SegmentSummary, SummaryRun } from "../packages/shared/src/index.js";
import { openTestDb } from "./dbTestUtils.js";

const clients: ReturnType<typeof openTestDb>[] = [];

afterEach(() => {
  for (const client of clients.splice(0)) {
    client.sqlite.close();
  }
});

describe("MessagesRepo", () => {
  it("saves messages and lists only the requested chat ordered by message id", () => {
    const { repo } = setupMessages();

    repo.save(message({ chatId: "chat-b", id: 1, text: "other chat" }));
    repo.save(message({ id: 3, text: "third" }));
    repo.save(message({ id: 1, text: "first" }));
    repo.save(message({ id: 2, text: "second", replyToId: 1, isCommand: true }));

    expect(repo.listByChat("chat-a")).toEqual([
      message({ id: 1, text: "first" }),
      message({ id: 2, text: "second", replyToId: 1, isCommand: true }),
      message({ id: 3, text: "third" }),
    ]);
  });

  it("updates an existing chat/message pair on save conflict", () => {
    const { repo } = setupMessages();

    repo.save(message({ id: 7, text: "before", authorName: "Alice" }));
    repo.save(message({ id: 7, text: "after", authorName: "Bob", kind: "photo" }));

    expect(repo.find("chat-a", 7)).toEqual(
      message({ id: 7, text: "after", authorName: "Bob", kind: "photo" }),
    );
  });

  it("finds inclusive ranges and returns undefined for missing messages", () => {
    const { repo } = setupMessages();

    repo.save(message({ id: 1 }));
    repo.save(message({ id: 2 }));
    repo.save(message({ id: 3 }));

    expect(repo.listRangeByChat("chat-a", 2, 3).map((item) => item.id)).toEqual([2, 3]);
    expect(repo.find("chat-a", 404)).toBeUndefined();
  });
});

describe("SummariesRepo", () => {
  it("returns the newest successful run per chat and ignores non-ok runs", () => {
    const { repo } = setupSummaries();

    repo.saveRun(run({ id: "old", commandMessageId: 1, createdAt: 10, finalText: "old" }));
    repo.saveRun(run({ id: "error", commandMessageId: 2, createdAt: 30, status: "error" }));
    repo.saveRun(run({ id: "new", commandMessageId: 3, createdAt: 20, finalText: "new" }));
    repo.saveRun(run({ id: "other-chat", chatId: "chat-b", commandMessageId: 4, createdAt: 40 }));

    expect(repo.findLastRun("chat-a")).toEqual(
      run({ id: "new", commandMessageId: 3, createdAt: 20, finalText: "new" }),
    );
  });

  it("updates a run when the same chat command is saved again", () => {
    const { repo } = setupSummaries();

    repo.saveRun(run({ id: "initial", commandMessageId: 9, finalText: "initial" }));
    repo.saveRun(
      run({
        id: "replacement",
        commandMessageId: 9,
        createdAt: 200,
        fromMessageId: 5,
        toMessageId: 8,
        mode: "count",
        finalText: "updated",
      }),
    );

    expect(repo.findLastRun("chat-a")).toEqual(
      run({
        id: "initial",
        commandMessageId: 9,
        createdAt: 200,
        fromMessageId: 5,
        toMessageId: 8,
        mode: "count",
        finalText: "updated",
      }),
    );
  });

  it("caches segments by chat, range, hash, and schema version", () => {
    const { repo } = setupSummaries();
    const summary = segment({ hash: "hash-a", title: "Original" });

    repo.saveSegment(summary);

    expect(repo.findCachedSegment("chat-a", 1, 3, "hash-a")).toEqual(summary);
    expect(repo.findCachedSegment("chat-a", 1, 3, "hash-a", 2)).toBeUndefined();
    expect(repo.findCachedSegment("chat-a", 1, 3, "hash-b")).toBeUndefined();
  });

  it("updates cached segment JSON on cache-key conflict", () => {
    const { repo } = setupSummaries();

    repo.saveSegment(segment({ title: "Before", summary: ["old"] }));
    repo.saveSegment(segment({ title: "After", summary: ["new"], importance: 3 }));

    expect(repo.findCachedSegment("chat-a", 1, 3, "hash-a")).toEqual(
      segment({ title: "After", summary: ["new"], importance: 3 }),
    );
  });
});

function setupMessages() {
  const client = openTestDb();
  clients.push(client);

  return { repo: new MessagesRepo(client.db) };
}

function setupSummaries() {
  const client = openTestDb();
  clients.push(client);

  return { repo: new SummariesRepo(client.db) };
}

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 1,
    chatId: "chat-a",
    date: 1_782_367_200_000,
    authorId: "alice",
    authorName: "Alice",
    text: `message ${overrides.id ?? 1}`,
    kind: "text",
    isCommand: false,
    ...overrides,
  };
}

function run(overrides: Partial<SummaryRun> = {}): SummaryRun {
  return {
    id: "run",
    chatId: "chat-a",
    commandMessageId: 1,
    createdAt: 100,
    fromMessageId: 1,
    toMessageId: 3,
    mode: "recent",
    status: "ok",
    finalText: "summary",
    ...overrides,
  };
}

function segment(overrides: Partial<SegmentSummary> = {}): SegmentSummary {
  return {
    segmentId: "segment-a",
    chatId: "chat-a",
    fromMessageId: 1,
    toMessageId: 3,
    hash: "hash-a",
    title: "Segment",
    summary: ["summary"],
    decisions: [],
    openQuestions: [],
    jokes: [],
    mentionedPeople: ["Alice"],
    importance: 1,
    ...overrides,
  };
}

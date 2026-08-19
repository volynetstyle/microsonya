import { afterEach, describe, expect, it } from "vitest";
import {
  MemoriesRepo,
  MessagesRepo,
  SummariesRepo,
} from "../packages/db/src/index.js";
import type {
  AppliedMemoryOp,
  ChatMessage,
  MemoryState,
  MemoryUpdate,
  SummaryRun,
} from "../packages/shared/src/index.js";
import type { SegmentReconstruction } from "../packages/discourse/src/production.js";
import { openTestDb } from "./dbTestUtils.js";

const clients: Awaited<ReturnType<typeof openTestDb>>[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) {
    await client.close();
  }
});

describe("MessagesRepo", () => {
  it("saves messages and lists only the requested chat ordered by message id", async () => {
    const { repo } = await setupMessages();

    await repo.save(message({ chatId: "chat-b", id: 1, text: "other chat" }));
    await repo.save(message({ id: 3, text: "third" }));
    await repo.save(message({ id: 1, text: "first" }));
    await repo.save(
      message({ id: 2, text: "second", replyToId: 1, isCommand: true }),
    );

    await expect(repo.listByChat("chat-a")).resolves.toEqual([
      message({ id: 1, text: "first" }),
      message({ id: 2, text: "second", replyToId: 1, isCommand: true }),
      message({ id: 3, text: "third" }),
    ]);
  });

  it("updates an existing chat/message pair on save conflict", async () => {
    const { repo } = await setupMessages();

    await repo.save(message({ id: 7, text: "before", authorName: "Alice" }));
    await repo.save(
      message({ id: 7, text: "after", authorName: "Bob", kind: "photo" }),
    );

    await expect(repo.find("chat-a", 7)).resolves.toEqual(
      message({ id: 7, text: "after", authorName: "Bob", kind: "photo" }),
    );
  });

  it("finds inclusive ranges and returns undefined for missing messages", async () => {
    const { repo } = await setupMessages();

    await repo.save(message({ id: 1 }));
    await repo.save(message({ id: 2 }));
    await repo.save(message({ id: 3 }));

    expect(
      (await repo.listRangeByChat("chat-a", 2, 3)).map((item) => item.id),
    ).toEqual([2, 3]);
    await expect(repo.find("chat-a", 404)).resolves.toBeUndefined();
    await expect(repo.listAfterByChat("chat-a", 1, 1)).resolves.toEqual([
      message({ id: 2 }),
    ]);
  });
});

describe("MemoriesRepo", () => {
  it("atomically persists materialized state and its append-only operation log", async () => {
    const { repo } = await setupMemories();
    const first = memoryState();

    await expect(repo.saveState(first, 0)).resolves.toBe(true);
    await expect(repo.findState("chat-a")).resolves.toEqual(first.state);
    await expect(repo.findState("chat-a")).resolves.not.toHaveProperty(
      "operations",
    );

    const support: AppliedMemoryOp = {
      id: "mop_000002",
      itemId: "mem_000001",
      op: { type: "support", targetId: "mem_000001", evidence: [2] },
      chatId: "chat-a",
      fromMessageId: 2,
      toMessageId: 2,
      inputHash: "hash-2",
      model: "test-model",
      promptVersion: "memory-ops-v1",
      stateVersion: 2,
      createdAt: 200,
    };
    const second: MemoryUpdate = {
      state: {
        ...first.state,
        version: 2,
        processedThroughMessageId: 2,
        nextOperationSequence: 3,
        items: first.state.items.map((item) => ({
          ...item,
          evidence: [1, 2],
          lastUpdatedMessageId: 2,
        })),
      },
      operations: [support],
    };

    await expect(repo.saveState(second, 1)).resolves.toBe(true);
    await expect(repo.findState("chat-a")).resolves.toEqual(second.state);
    await expect(repo.saveState(second, 1)).resolves.toBe(false);
    await expect(repo.findState("chat-a")).resolves.toEqual(second.state);
  });

  it("keeps chats isolated", async () => {
    const { repo } = await setupMemories();
    await repo.saveState(memoryState(), 0);

    await expect(repo.findState("chat-b")).resolves.toBeUndefined();
  });
});

describe("SummariesRepo", () => {
  it("returns the newest successful run per chat and ignores non-ok runs", async () => {
    const { repo } = await setupSummaries();

    await repo.saveRun(
      run({ id: "old", commandMessageId: 1, createdAt: 10, finalText: "old" }),
    );
    await repo.saveRun(
      run({ id: "error", commandMessageId: 2, createdAt: 30, status: "error" }),
    );
    await repo.saveRun(
      run({ id: "new", commandMessageId: 3, createdAt: 20, finalText: "new" }),
    );
    await repo.saveRun(
      run({
        id: "other-chat",
        chatId: "chat-b",
        commandMessageId: 4,
        createdAt: 40,
      }),
    );

    await expect(repo.findLastRun("chat-a")).resolves.toEqual(
      run({ id: "new", commandMessageId: 3, createdAt: 20, finalText: "new" }),
    );
  });

  it("updates a run when the same chat command is saved again", async () => {
    const { repo } = await setupSummaries();

    await repo.saveRun(
      run({ id: "initial", commandMessageId: 9, finalText: "initial" }),
    );
    await repo.saveRun(
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

    await expect(repo.findLastRun("chat-a")).resolves.toEqual(
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

  it("caches segments by chat, range, hash, and schema version", async () => {
    const { repo } = await setupSummaries();
    const summary = segment({ hash: "hash-a" }, "Original");

    await repo.saveReconstruction(summary);

    await expect(
      repo.findCachedReconstruction("chat-a", 1, 3, "hash-a"),
    ).resolves.toEqual(summary);
    await expect(
      repo.findCachedReconstruction("chat-a", 1, 3, "hash-a", 2),
    ).resolves.toBeUndefined();
    await expect(
      repo.findCachedReconstruction("chat-a", 1, 3, "hash-b"),
    ).resolves.toBeUndefined();
  });

  it("updates cached segment JSON on cache-key conflict", async () => {
    const { repo } = await setupSummaries();

    await repo.saveReconstruction(segment({}, "Before"));
    await repo.saveReconstruction(segment({}, "After"));

    await expect(
      repo.findCachedReconstruction("chat-a", 1, 3, "hash-a"),
    ).resolves.toEqual(segment({}, "After"));
  });
});

async function setupMessages() {
  const client = await openTestDb();
  clients.push(client);

  return { repo: new MessagesRepo(client.db) };
}

async function setupSummaries() {
  const client = await openTestDb();
  clients.push(client);

  return { repo: new SummariesRepo(client.db) };
}

async function setupMemories() {
  const client = await openTestDb();
  clients.push(client);

  return { repo: new MemoriesRepo(client.db) };
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

function segment(
  overrides: Partial<SegmentReconstruction> = {},
  title = "Segment",
): SegmentReconstruction {
  return {
    segmentId: "segment-a",
    chatId: "chat-a",
    fromMessageId: 1,
    toMessageId: 3,
    hash: "hash-a",
    reconstruction: { title, events: [] },
    ...overrides,
  };
}

function memoryState(): MemoryUpdate {
  const operation: AppliedMemoryOp = {
    id: "mop_000001",
    itemId: "mem_000001",
    createdItemId: "mem_000001",
    op: {
      type: "create",
      kind: "decision",
      text: "Use PostgreSQL",
      evidence: [1],
    },
    chatId: "chat-a",
    fromMessageId: 1,
    toMessageId: 1,
    inputHash: "hash-1",
    model: "test-model",
    promptVersion: "memory-ops-v1",
    stateVersion: 1,
    createdAt: 100,
  };

  return {
    state: {
      chatId: "chat-a",
      version: 1,
      processedThroughMessageId: 1,
      nextMemorySequence: 2,
      nextOperationSequence: 2,
      items: [
        {
          id: "mem_000001",
          kind: "decision",
          text: "Use PostgreSQL",
          status: "active",
          evidence: [1],
          createdAtMessageId: 1,
          lastUpdatedMessageId: 1,
        },
      ],
    },
    operations: [operation],
  };
}

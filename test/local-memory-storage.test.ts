import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  InMemoryMessagesRepo,
  InMemorySummariesRepo,
  LocalMemoryDatabase,
} from "../apps/telegram/bot/src/runtime/inMemoryStorage.js";
import type { ChatMessage, SummaryRun } from "../packages/shared/src/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("local memory storage", () => {
  it("restores messages and summary runs in a fresh database instance", async () => {
    const directory = await mkdtemp(join(tmpdir(), "microsonya-memory-"));
    temporaryDirectories.push(directory);
    const filePath = join(directory, "nested", "memory.json");
    const first = new LocalMemoryDatabase(filePath);
    const messages = new InMemoryMessagesRepo(first);
    const summaries = new InMemorySummariesRepo(first);
    const message: ChatMessage = {
      id: 7,
      chatId: "chat",
      date: 1_700_000_000_000,
      authorId: "alice",
      authorName: "Alice",
      text: "Ship it",
      kind: "text",
    };
    const run: SummaryRun = {
      chatId: "chat",
      commandMessageId: 8,
      createdAt: message.date + 1,
      fromMessageId: 7,
      toMessageId: 7,
      mode: "recent",
      status: "ok",
      finalText: "Shipped",
    };

    await messages.save(message);
    await summaries.saveRun(run);

    const restored = new LocalMemoryDatabase(filePath);
    await expect(
      new InMemoryMessagesRepo(restored).listByChat("chat"),
    ).resolves.toEqual([message]);
    await expect(
      new InMemorySummariesRepo(restored).findLastRun("chat"),
    ).resolves.toEqual(run);
    await expect(readFile(filePath, "utf8")).resolves.toContain('"version": 1');
  });
});

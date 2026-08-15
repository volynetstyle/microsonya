import {
  MemoriesRepo,
  MessagesRepo,
  openDb,
  SummariesRepo,
} from "@microsonya/db";
import type { AppConfig } from "./config.js";
import {
  InMemoryMessagesRepo,
  InMemoryMemoriesRepo,
  InMemorySummariesRepo,
} from "./runtime/inMemoryStorage.js";
import { requiredConfigValue } from "./errors.js";

export type Storage = {
  memory: MemoriesRepo | InMemoryMemoriesRepo;
  messages: MessagesRepo | InMemoryMessagesRepo;
  summaries: SummariesRepo | InMemorySummariesRepo;
};

export function createStorage(config: AppConfig): Storage {
  if (config.storageMode === "memory") {
    return createInMemoryStorage();
  }

  return createPostgresStorage(
    requiredConfigValue(config.databaseUrl, "DATABASE_URL"),
  );
}

function createInMemoryStorage(): Storage {
  return {
    memory: new InMemoryMemoriesRepo(),
    messages: new InMemoryMessagesRepo(),
    summaries: new InMemorySummariesRepo(),
  };
}

function createPostgresStorage(databaseUrl: string): Storage {
  const { db } = openDb(databaseUrl);

  return {
    memory: new MemoriesRepo(db),
    messages: new MessagesRepo(db),
    summaries: new SummariesRepo(db),
  };
}

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
  LocalMemoryDatabase,
} from "./runtime/inMemoryStorage.js";
import { requiredConfigValue } from "./errors.js";

export type Storage = {
  memory: MemoriesRepo | InMemoryMemoriesRepo;
  messages: MessagesRepo | InMemoryMessagesRepo;
  summaries: SummariesRepo | InMemorySummariesRepo;
};

export function createStorage(config: AppConfig): Storage {
  if (config.storageMode === "memory") {
    return createInMemoryStorage(config.memoryFilePath);
  }

  return createPostgresStorage(
    requiredConfigValue(config.databaseUrl, "DATABASE_URL"),
  );
}

function createInMemoryStorage(filePath: string): Storage {
  const database = new LocalMemoryDatabase(filePath);
  return {
    memory: new InMemoryMemoriesRepo(database),
    messages: new InMemoryMessagesRepo(database),
    summaries: new InMemorySummariesRepo(database),
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

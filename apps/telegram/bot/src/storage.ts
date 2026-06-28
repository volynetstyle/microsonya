import { MessagesRepo, openDb, SummariesRepo } from "@microsonya/db";
import type { AppConfig } from "./config.js";
import {
  InMemoryMessagesRepo,
  InMemorySummariesRepo,
} from "./runtime/inMemoryStorage.js";
import { requiredConfigValue } from "./errors.js";

export type Storage = {
  messages: MessagesRepo | InMemoryMessagesRepo;
  summaries: SummariesRepo | InMemorySummariesRepo;
};

export function createStorage(config: AppConfig): Storage {
  if (config.disabledServices.has("db")) {
    return createInMemoryStorage();
  }

  return createPostgresStorage(
    requiredConfigValue(config.databaseUrl, "DATABASE_URL"),
  );
}

function createInMemoryStorage(): Storage {
  return {
    messages: new InMemoryMessagesRepo(),
    summaries: new InMemorySummariesRepo(),
  };
}

function createPostgresStorage(databaseUrl: string): Storage {
  const { db } = openDb(databaseUrl);

  return {
    messages: new MessagesRepo(db),
    summaries: new SummariesRepo(db),
  };
}
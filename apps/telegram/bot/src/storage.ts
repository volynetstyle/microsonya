import { MessagesRepo, openDb, SummariesRepo } from "@microsonya/db";
import type { AppConfig } from "./config.js";

export type Storage = {
  messages: MessagesRepo;
  summaries: SummariesRepo;
};

export function createStorage(config: AppConfig): Storage {
  return createPostgresStorage(config.databaseUrl);
}

function createPostgresStorage(databaseUrl: string): Storage {
  const { db } = openDb(databaseUrl);

  return {
    messages: new MessagesRepo(db),
    summaries: new SummariesRepo(db),
  };
}

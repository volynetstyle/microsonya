import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";

export type MicrosonyaDb = BetterSQLite3Database<typeof schema>;

export type DbClient = {
  sqlite: Database.Database;
  db: MicrosonyaDb;
};

export function openDb(path = "microsonya.sqlite"): DbClient {
  const sqlite = new Database(path);
  migrate(sqlite);
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

export function migrate(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      chat_id TEXT NOT NULL,
      message_id INTEGER NOT NULL,
      date INTEGER NOT NULL,
      author_id TEXT NOT NULL,
      author_name TEXT,
      text TEXT,
      reply_to_message_id INTEGER,
      kind TEXT NOT NULL DEFAULT 'text',
      is_command INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (chat_id, message_id)
    );

    CREATE TABLE IF NOT EXISTS summary_runs (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      command_message_id INTEGER NOT NULL,
      from_message_id INTEGER NOT NULL,
      to_message_id INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      text TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS segment_summaries (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      from_message_id INTEGER NOT NULL,
      to_message_id INTEGER NOT NULL,
      hash TEXT NOT NULL,
      title TEXT NOT NULL,
      json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_chat_date ON messages (chat_id, date);
    CREATE INDEX IF NOT EXISTS idx_messages_chat_message ON messages (chat_id, message_id);
    CREATE INDEX IF NOT EXISTS idx_summary_runs_chat_created ON summary_runs (chat_id, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_segment_summaries_cache
      ON segment_summaries (chat_id, from_message_id, to_message_id, hash);
  `);
}

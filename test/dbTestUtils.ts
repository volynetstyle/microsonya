import { openDb, type DbClient } from "../packages/db/src/index.js";

export function openTestDb(): DbClient {
  const client = openDb(":memory:");

  client.sqlite.exec(`
    CREATE TABLE messages (
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

    CREATE INDEX idx_messages_chat_date ON messages (chat_id, date);
    CREATE INDEX idx_messages_chat_message ON messages (chat_id, message_id);

    CREATE TABLE summary_runs (
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

    CREATE UNIQUE INDEX idx_summary_runs_command
      ON summary_runs (chat_id, command_message_id);
    CREATE INDEX idx_summary_runs_chat_created
      ON summary_runs (chat_id, created_at);
    CREATE INDEX idx_summary_runs_chat_range
      ON summary_runs (chat_id, from_message_id, to_message_id);

    CREATE TABLE segment_summaries (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      from_message_id INTEGER NOT NULL,
      to_message_id INTEGER NOT NULL,
      hash TEXT NOT NULL,
      schema_version INTEGER NOT NULL DEFAULT 1,
      model TEXT,
      title TEXT NOT NULL,
      json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE UNIQUE INDEX idx_segment_summaries_cache
      ON segment_summaries (
        chat_id,
        from_message_id,
        to_message_id,
        hash,
        schema_version
      );
    CREATE INDEX idx_segment_summaries_chat_range
      ON segment_summaries (chat_id, from_message_id, to_message_id);
    CREATE INDEX idx_segment_summaries_chat_created
      ON segment_summaries (chat_id, created_at);
  `);

  return client;
}

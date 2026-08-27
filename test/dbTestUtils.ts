import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../packages/db/src/schema.js";
import type { DbClient, MicrosonyaDb } from "../packages/db/src/index.js";

export async function openTestDb(): Promise<DbClient> {
  const client = new PGlite();

  await client.exec(`
    CREATE TABLE messages (
      chat_id TEXT NOT NULL,
      message_id INTEGER NOT NULL,
      date BIGINT NOT NULL,
      author_id TEXT NOT NULL,
      author_name TEXT,
      text TEXT,
      reply_to_message_id INTEGER,
      kind TEXT NOT NULL DEFAULT 'text',
      is_command BOOLEAN NOT NULL DEFAULT false,
      PRIMARY KEY (chat_id, message_id)
    );

    CREATE INDEX idx_messages_chat_date ON messages (chat_id, date);
    CREATE INDEX idx_messages_chat_message ON messages (chat_id, message_id);

    CREATE TABLE summary_runs (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      command_message_id INTEGER NOT NULL,
      from_message_id INTEGER,
      to_message_id INTEGER,
      message_count INTEGER NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL,
      started_at BIGINT NOT NULL,
      completed_at BIGINT,
      checkpoint_before INTEGER,
      checkpoint_after INTEGER,
      eligible_count INTEGER NOT NULL DEFAULT 0,
      context_count INTEGER NOT NULL DEFAULT 0,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      action TEXT,
      text TEXT,
      classifier_model TEXT,
      summarizer_model TEXT,
      classifier_prompt_hash TEXT,
      summary_prompt_hash TEXT,
      policy_hash TEXT NOT NULL,
      classifier_latency_ms INTEGER,
      summarizer_latency_ms INTEGER,
      total_latency_ms INTEGER,
      summary_text_ciphertext BYTEA,
      error_code TEXT,
      input_hash TEXT NOT NULL
    );

    CREATE UNIQUE INDEX idx_summary_runs_command
      ON summary_runs (chat_id, command_message_id);
    CREATE INDEX idx_summary_runs_chat_created
      ON summary_runs (chat_id, created_at);
    CREATE INDEX idx_summary_runs_chat_range
      ON summary_runs (chat_id, from_message_id, to_message_id);

    CREATE TABLE summary_run_messages (
      run_id TEXT NOT NULL REFERENCES summary_runs (id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL,
      chat_id TEXT NOT NULL,
      message_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      author_id TEXT NOT NULL,
      author_name TEXT,
      text_ciphertext BYTEA,
      sent_at BIGINT NOT NULL,
      reply_to_id INTEGER,
      forward_origin JSONB,
      PRIMARY KEY (run_id, ordinal)
    );
    CREATE INDEX idx_summary_run_messages_source
      ON summary_run_messages (chat_id, message_id);

    CREATE TABLE model_invocations (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES summary_runs (id) ON DELETE CASCADE,
      stage TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_hash TEXT NOT NULL,
      input_tokens INTEGER,
      output_tokens INTEGER,
      latency_ms INTEGER,
      output_json JSONB,
      output_text_ciphertext BYTEA,
      status TEXT NOT NULL,
      error_code TEXT,
      created_at BIGINT NOT NULL
    );
    CREATE INDEX idx_model_invocations_run_stage
      ON model_invocations (run_id, stage);

    CREATE TABLE summary_feedback (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES summary_runs (id) ON DELETE CASCADE,
      source TEXT NOT NULL,
      signal TEXT NOT NULL,
      comment TEXT,
      corrected_summary_ciphertext BYTEA,
      created_at BIGINT NOT NULL
    );
    CREATE INDEX idx_summary_feedback_run_created
      ON summary_feedback (run_id, created_at);

    CREATE TABLE dataset_candidates (
      run_id TEXT PRIMARY KEY REFERENCES summary_runs (id) ON DELETE CASCADE,
      priority INTEGER NOT NULL,
      reasons TEXT[] NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at BIGINT NOT NULL
    );
    CREATE INDEX idx_dataset_candidates_queue
      ON dataset_candidates (status, priority);

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
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
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

    CREATE TABLE memory_states (
      chat_id TEXT PRIMARY KEY,
      version INTEGER NOT NULL,
      processed_through_message_id INTEGER,
      next_memory_sequence INTEGER NOT NULL,
      next_operation_sequence INTEGER NOT NULL,
      items JSONB NOT NULL,
      updated_at BIGINT NOT NULL
    );

    CREATE TABLE memory_operations (
      chat_id TEXT NOT NULL REFERENCES memory_states (chat_id),
      id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      created_item_id TEXT,
      op JSONB NOT NULL,
      from_message_id INTEGER NOT NULL,
      to_message_id INTEGER NOT NULL,
      input_hash TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      state_version INTEGER NOT NULL,
      created_at BIGINT NOT NULL,
      PRIMARY KEY (chat_id, id)
    );

    CREATE INDEX idx_memory_operations_chat_state
      ON memory_operations (chat_id, state_version);
    CREATE INDEX idx_memory_operations_chat_range
      ON memory_operations (chat_id, from_message_id, to_message_id);
  `);

  return {
    pool: undefined as never,
    db: drizzle(client, { schema }) as unknown as MicrosonyaDb,
    close: () => client.close(),
  };
}

import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

export const messages = pgTable(
  "messages",
  {
    chatId: text("chat_id").notNull(),
    messageId: integer("message_id").notNull(),
    date: bigint("date", { mode: "number" }).notNull(),
    authorId: text("author_id").notNull(),
    authorNameCiphertext: bytea("author_name_ciphertext").notNull(),
    textCiphertext: bytea("text_ciphertext").notNull(),
    replyToMessageId: integer("reply_to_message_id"),
    kind: text("kind").notNull().default("text"),
    isCommand: boolean("is_command").notNull().default(false),
  },
  (table) => [
    primaryKey({ columns: [table.chatId, table.messageId] }),
    index("idx_messages_chat_date").on(table.chatId, table.date),
  ],
);

export const summaryRuns = pgTable(
  "summary_runs",
  {
    id: text("id").primaryKey(),
    chatId: text("chat_id").notNull(),
    commandMessageId: integer("command_message_id").notNull(),
    fromMessageId: integer("from_message_id"),
    toMessageId: integer("to_message_id"),
    messageCount: integer("message_count").notNull().default(0),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    startedAt: bigint("started_at", { mode: "number" }).notNull(),
    completedAt: bigint("completed_at", { mode: "number" }),
    checkpointBefore: integer("checkpoint_before"),
    checkpointAfter: integer("checkpoint_after"),
    eligibleCount: integer("eligible_count").notNull().default(0),
    contextCount: integer("context_count").notNull().default(0),
    mode: text("mode").notNull(),
    status: text("status").notNull(),
    action: text("action"),
    classifierModel: text("classifier_model"),
    summarizerModel: text("summarizer_model"),
    classifierPromptHash: text("classifier_prompt_hash"),
    summaryPromptHash: text("summary_prompt_hash"),
    policyHash: text("policy_hash").notNull(),
    classifierLatencyMs: integer("classifier_latency_ms"),
    summarizerLatencyMs: integer("summarizer_latency_ms"),
    totalLatencyMs: integer("total_latency_ms"),
    summaryTextCiphertext: bytea("summary_text_ciphertext"),
    errorCode: text("error_code"),
    inputHash: text("input_hash").notNull(),
  },
  (table) => [
    uniqueIndex("idx_summary_runs_command").on(
      table.chatId,
      table.commandMessageId,
    ),
    index("idx_summary_runs_chat_created").on(table.chatId, table.createdAt),
  ],
);

/** Mutable authoritative orchestration state; summaryRuns remains evidence. */
export const summaryRunLifecycle = pgTable(
  "summary_run_lifecycle",
  {
    id: text("id").primaryKey(),
    idempotencyKey: text("idempotency_key").notNull(),
    chatId: text("chat_id").notNull(),
    chatIdCiphertext: bytea("chat_id_ciphertext").notNull(),
    commandMessageId: integer("command_message_id").notNull(),
    commandDate: bigint("command_date", { mode: "number" }).notNull(),
    mode: text("mode").notNull(),
    requestedCount: integer("requested_count"),
    status: text("status").notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
    attempt: integer("attempt").notNull().default(0),
    leaseExpiresAt: bigint("lease_expires_at", { mode: "number" }),
    nextRetryAt: bigint("next_retry_at", { mode: "number" }),
    lastErrorCode: text("last_error_code"),
    lastErrorAt: bigint("last_error_at", { mode: "number" }),
    processorVersion: text("processor_version"),
    model: text("model"),
    promptVersion: text("prompt_version"),
    summaryCiphertext: bytea("summary_ciphertext"),
    deliveredAt: bigint("delivered_at", { mode: "number" }),
    telegramMessageId: integer("telegram_message_id"),
  },
  (table) => [
    uniqueIndex("idx_summary_run_lifecycle_idempotency").on(
      table.idempotencyKey,
    ),
    index("idx_summary_run_lifecycle_status_updated").on(
      table.status,
      table.updatedAt,
    ),
    index("idx_summary_run_lifecycle_retry").on(
      table.status,
      table.nextRetryAt,
    ),
    check(
      "summary_run_lifecycle_status_check",
      sql`${table.status} in ('created', 'queued', 'processing', 'summary_ready', 'delivering', 'completed', 'retry_wait', 'failed_permanent')`,
    ),
    check(
      "summary_run_lifecycle_mode_check",
      sql`${table.mode} in ('recent', 'today', 'count')`,
    ),
    check("summary_run_lifecycle_attempt_check", sql`${table.attempt} >= 0`),
    check(
      "summary_run_lifecycle_count_check",
      sql`(${table.mode} = 'count' and ${table.requestedCount} is not null and ${table.requestedCount} > 0) or (${table.mode} <> 'count' and ${table.requestedCount} is null)`,
    ),
  ],
);

export const summaryRunMessages = pgTable(
  "summary_run_messages",
  {
    runId: text("run_id")
      .notNull()
      .references(() => summaryRuns.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    chatId: text("chat_id").notNull(),
    messageId: integer("message_id").notNull(),
    role: text("role").notNull(),
    authorId: text("author_id").notNull(),
    authorNameCiphertext: bytea("author_name_ciphertext").notNull(),
    textCiphertext: bytea("text_ciphertext").notNull(),
    sentAt: bigint("sent_at", { mode: "number" }).notNull(),
    replyToId: integer("reply_to_id"),
    forwardOriginCiphertext: bytea("forward_origin_ciphertext"),
  },
  (table) => [
    primaryKey({ columns: [table.runId, table.ordinal] }),
    index("idx_summary_run_messages_source").on(table.chatId, table.messageId),
  ],
);

export const modelInvocations = pgTable(
  "model_invocations",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => summaryRuns.id, { onDelete: "cascade" }),
    stage: text("stage").notNull(),
    model: text("model").notNull(),
    promptHash: text("prompt_hash").notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    latencyMs: integer("latency_ms"),
    outputJson: jsonb("output_json"),
    outputTextCiphertext: bytea("output_text_ciphertext"),
    status: text("status").notNull(),
    errorCode: text("error_code"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("idx_model_invocations_run_stage").on(table.runId, table.stage),
  ],
);

export const summaryFeedback = pgTable(
  "summary_feedback",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => summaryRuns.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    signal: text("signal").notNull(),
    commentCiphertext: bytea("comment_ciphertext"),
    correctedSummaryCiphertext: bytea("corrected_summary_ciphertext"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("idx_summary_feedback_run_created").on(table.runId, table.createdAt),
  ],
);

export const datasetCandidates = pgTable(
  "dataset_candidates",
  {
    runId: text("run_id")
      .primaryKey()
      .references(() => summaryRuns.id, { onDelete: "cascade" }),
    priority: integer("priority").notNull(),
    reasons: text("reasons").array().notNull(),
    status: text("status").notNull().default("pending"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("idx_dataset_candidates_queue").on(table.status, table.priority),
  ],
);

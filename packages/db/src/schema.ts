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

const bytea = customType<{ data: Buffer; driverData: unknown }>({
  dataType: () => "bytea",
  toDriver: (value) => value,
  fromDriver: (value) => normalizeBytea(value),
});

/** Normalize bytea values at the driver boundary across Node pg and Hyperdrive. */
export function normalizeBytea(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (typeof value === "string" && /^\\x(?:[\da-f]{2})*$/iu.test(value)) {
    return Buffer.from(value.slice(2), "hex");
  }
  throw new TypeError("Unsupported PostgreSQL bytea driver value.");
}

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
    orchestrationRunId: text("orchestration_run_id"),
    orchestrationAttempt: integer("orchestration_attempt"),
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
    /** Canonical, opaque participant references for presentation only. */
    summaryInline: jsonb("summary_inline"),
    errorCode: text("error_code"),
    inputHash: text("input_hash").notNull(),
  },
  (table) => [
    index("idx_summary_runs_command").on(table.chatId, table.commandMessageId),
    index("idx_summary_runs_chat_created").on(table.chatId, table.createdAt),
    index("idx_summary_runs_wma_page").on(
      table.chatId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    uniqueIndex("idx_summary_runs_orchestration_attempt").on(
      table.orchestrationRunId,
      table.orchestrationAttempt,
    ),
    check(
      "summary_runs_orchestration_attempt_check",
      sql`(${table.orchestrationRunId} is null and ${table.orchestrationAttempt} is null) or (${table.orchestrationRunId} is not null and ${table.orchestrationAttempt} is not null and ${table.orchestrationAttempt} > 0)`,
    ),
    check(
      "summary_runs_summarized_text_check",
      sql`${table.status} <> 'summarized' or ${table.summaryTextCiphertext} is not null`,
    ),
  ],
);

/**
 * Private, viewer-owned names. Both identifiers are opaque HMAC-derived
 * values; labels remain encrypted at rest like source display names.
 */
export const participantAliases = pgTable(
  "participant_aliases",
  {
    ownerUserId: text("owner_user_id").notNull(),
    participantId: text("participant_id").notNull(),
    displayLabelCiphertext: bytea("display_label_ciphertext").notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerUserId, table.participantId] }),
    index("idx_participant_aliases_owner").on(table.ownerUserId),
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
    messageThreadId: integer("message_thread_id"),
    commandDate: bigint("command_date", { mode: "number" }).notNull(),
    mode: text("mode").notNull(),
    requestedCount: integer("requested_count"),
    status: text("status").notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
    attempt: integer("attempt").notNull().default(0),
    deliveryAttempt: integer("delivery_attempt").notNull().default(0),
    leaseExpiresAt: bigint("lease_expires_at", { mode: "number" }),
    leaseToken: text("lease_token"),
    nextRetryAt: bigint("next_retry_at", { mode: "number" }),
    retryStage: text("retry_stage"),
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
    uniqueIndex("idx_summary_run_lifecycle_one_processing_per_chat")
      .on(table.chatId)
      .where(sql`${table.status} = 'processing'`),
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
      "summary_run_lifecycle_delivery_attempt_check",
      sql`${table.deliveryAttempt} >= 0`,
    ),
    check(
      "summary_run_lifecycle_lease_check",
      sql`(${table.status} in ('processing', 'delivering') and ${table.leaseToken} is not null and ${table.leaseExpiresAt} is not null) or (${table.status} not in ('processing', 'delivering') and ${table.leaseToken} is null and ${table.leaseExpiresAt} is null)`,
    ),
    check(
      "summary_run_lifecycle_retry_stage_check",
      sql`(${table.status} = 'retry_wait' and ${table.retryStage} in ('processing', 'delivery')) or (${table.status} = 'queued' and (${table.retryStage} is null or ${table.retryStage} in ('processing', 'delivery'))) or (${table.status} not in ('retry_wait', 'queued') and ${table.retryStage} is null)`,
    ),
    check(
      "summary_run_lifecycle_delivery_summary_check",
      sql`(${table.status} not in ('summary_ready', 'delivering', 'completed') and ${table.retryStage} is distinct from 'delivery') or ${table.summaryCiphertext} is not null`,
    ),
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

/** Read projection for the Web Mini App; never reconstruct the home screen
 * from mutable lifecycle/orchestration history. */
export const wmaChatCatalog = pgTable(
  "wma_chat_catalog",
  {
    chatId: text("chat_id").primaryKey(),
    chatIdCiphertext: bytea("chat_id_ciphertext").notNull(),
    summaryCount: integer("summary_count").notNull().default(0),
    messageCount: integer("message_count").notNull().default(0),
    lastSummaryAt: bigint("last_summary_at", { mode: "number" }),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("idx_wma_chat_catalog_last_summary").on(table.lastSummaryAt),
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

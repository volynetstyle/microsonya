import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { MemoryItem, MemoryOp } from "@microsonya/shared";

export const messages = pgTable(
  "messages",
  {
    chatId: text("chat_id").notNull(),
    messageId: integer("message_id").notNull(),

    date: bigint("date", { mode: "number" }).notNull(),

    authorId: text("author_id").notNull(),
    authorName: text("author_name"),

    text: text("text"),

    replyToMessageId: integer("reply_to_message_id"),

    kind: text("kind").notNull().default("text"),

    isCommand: boolean("is_command").notNull().default(false),
  },
  (table) => [
    primaryKey({
      columns: [table.chatId, table.messageId],
    }),

    index("idx_messages_chat_date").on(table.chatId, table.date),

    index("idx_messages_chat_message").on(table.chatId, table.messageId),
  ],
);

export const summaryRuns = pgTable(
  "summary_runs",
  {
    id: text("id").primaryKey(),

    chatId: text("chat_id").notNull(),

    commandMessageId: integer("command_message_id").notNull(),

    fromMessageId: integer("from_message_id").notNull(),
    toMessageId: integer("to_message_id").notNull(),

    createdAt: bigint("created_at", { mode: "number" }).notNull(),

    mode: text("mode").notNull(),
    status: text("status").notNull(),

    text: text("text").notNull(),
  },
  (table) => [
    uniqueIndex("idx_summary_runs_command").on(
      table.chatId,
      table.commandMessageId,
    ),

    index("idx_summary_runs_chat_created").on(table.chatId, table.createdAt),

    index("idx_summary_runs_chat_range").on(
      table.chatId,
      table.fromMessageId,
      table.toMessageId,
    ),
  ],
);

export const segmentSummaries = pgTable(
  "segment_summaries",
  {
    id: text("id").primaryKey(),
    chatId: text("chat_id").notNull(),

    fromMessageId: integer("from_message_id").notNull(),
    toMessageId: integer("to_message_id").notNull(),

    hash: text("hash").notNull(),

    schemaVersion: integer("schema_version").notNull().default(1),
    model: text("model"),

    title: text("title").notNull(),
    json: text("json").notNull(),

    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [
    uniqueIndex("idx_segment_summaries_cache").on(
      table.chatId,
      table.fromMessageId,
      table.toMessageId,
      table.hash,
      table.schemaVersion,
    ),

    index("idx_segment_summaries_chat_range").on(
      table.chatId,
      table.fromMessageId,
      table.toMessageId,
    ),

    index("idx_segment_summaries_chat_created").on(
      table.chatId,
      table.createdAt,
    ),
  ],
);

export const memoryStates = pgTable("memory_states", {
  chatId: text("chat_id").primaryKey(),
  version: integer("version").notNull(),
  processedThroughMessageId: integer("processed_through_message_id"),
  nextMemorySequence: integer("next_memory_sequence").notNull(),
  nextOperationSequence: integer("next_operation_sequence").notNull(),
  items: jsonb("items").$type<MemoryItem[]>().notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

export const memoryOperations = pgTable(
  "memory_operations",
  {
    chatId: text("chat_id")
      .notNull()
      .references(() => memoryStates.chatId),
    id: text("id").notNull(),
    itemId: text("item_id").notNull(),
    createdItemId: text("created_item_id"),
    op: jsonb("op").$type<MemoryOp>().notNull(),
    fromMessageId: integer("from_message_id").notNull(),
    toMessageId: integer("to_message_id").notNull(),
    inputHash: text("input_hash").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    stateVersion: integer("state_version").notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.chatId, table.id] }),
    index("idx_memory_operations_chat_state").on(
      table.chatId,
      table.stateVersion,
    ),
    index("idx_memory_operations_chat_range").on(
      table.chatId,
      table.fromMessageId,
      table.toMessageId,
    ),
  ],
);

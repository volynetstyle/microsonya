import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const messages = sqliteTable(
  "messages",
  {
    chatId: text("chat_id").notNull(),
    messageId: integer("message_id").notNull(),

    date: integer("date").notNull(),

    authorId: text("author_id").notNull(),
    authorName: text("author_name"),

    text: text("text"),

    replyToMessageId: integer("reply_to_message_id"),

    kind: text("kind").notNull().default("text"),

    isCommand: integer("is_command", { mode: "boolean" })
      .notNull()
      .default(false),
  },
  (table) => [
    primaryKey({
      columns: [table.chatId, table.messageId],
    }),

    index("idx_messages_chat_date").on(table.chatId, table.date),

    index("idx_messages_chat_message").on(table.chatId, table.messageId),
  ],
);

export const summaryRuns = sqliteTable(
  "summary_runs",
  {
    id: text("id").primaryKey(),

    chatId: text("chat_id").notNull(),

    commandMessageId: integer("command_message_id").notNull(),

    fromMessageId: integer("from_message_id").notNull(),
    toMessageId: integer("to_message_id").notNull(),

    createdAt: integer("created_at").notNull(),

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

export const segmentSummaries = sqliteTable(
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

    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
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

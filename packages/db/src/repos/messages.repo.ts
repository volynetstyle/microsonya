import { and, asc, eq, gt, gte, lte } from "drizzle-orm";
import {
  asAuthorId,
  asChatId,
  asMessageId,
  asTimestampMs,
  type ChatId,
  type ChatMessage,
  type MessageId,
} from "@microsonya/shared";
import type { MicrosonyaDb } from "../client.js";
import { messages } from "../schema.js";

type MessageRow = typeof messages.$inferSelect;

function mapMessageRow(row: MessageRow): ChatMessage {
  const author = Object.freeze({
    id: asAuthorId(row.authorId),
    label: row.authorName ?? row.authorId,
  });

  return Object.freeze({
    id: asMessageId(row.messageId),
    chatId: asChatId(row.chatId),
    author,
    time: asTimestampMs(row.date),
    parentId:
      row.replyToMessageId === null ? null : asMessageId(row.replyToMessageId),
    text: row.text ?? "",
  });
}

export class MessagesRepo {
  constructor(private readonly db: MicrosonyaDb) {}

  async save(message: ChatMessage): Promise<void> {
    await this.db
      .insert(messages)
      .values({
        chatId: message.chatId,
        messageId: message.id,
        date: message.time,
        authorId: message.author.id,
        authorName: message.author.label,
        text: message.text,
        replyToMessageId: message.parentId,
        kind: "text",
        isCommand: false,
      })
      .onConflictDoUpdate({
        target: [messages.chatId, messages.messageId],
        set: {
          date: message.time,
          authorId: message.author.id,
          authorName: message.author.label,
          text: message.text,
          replyToMessageId: message.parentId,
          kind: "text",
          isCommand: false,
        },
      })
      .execute();
  }

  async listByChat(chatId: ChatId): Promise<ChatMessage[]> {
    return (
      await this.db
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.chatId, chatId),
            eq(messages.kind, "text"),
            eq(messages.isCommand, false),
          ),
        )
        .orderBy(asc(messages.date), asc(messages.messageId))
    ).map(mapMessageRow);
  }

  async listRangeByChat(
    chatId: ChatId,
    fromMessageId: MessageId,
    toMessageId: MessageId,
  ): Promise<ChatMessage[]> {
    return (
      await this.db
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.chatId, chatId),
            gte(messages.messageId, fromMessageId),
            lte(messages.messageId, toMessageId),
            eq(messages.kind, "text"),
            eq(messages.isCommand, false),
          ),
        )
        .orderBy(asc(messages.date), asc(messages.messageId))
    ).map(mapMessageRow);
  }

  async listAfterByChat(
    chatId: ChatId,
    afterMessageId: MessageId,
    limit: number,
  ): Promise<ChatMessage[]> {
    return (
      await this.db
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.chatId, chatId),
            gt(messages.messageId, afterMessageId),
            eq(messages.kind, "text"),
            eq(messages.isCommand, false),
          ),
        )
        .orderBy(asc(messages.date), asc(messages.messageId))
        .limit(limit)
    ).map(mapMessageRow);
  }

  async find(
    chatId: ChatId,
    messageId: MessageId,
  ): Promise<ChatMessage | undefined> {
    const row = (
      await this.db
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.chatId, chatId),
            eq(messages.messageId, messageId),
            eq(messages.kind, "text"),
            eq(messages.isCommand, false),
          ),
        )
        .limit(1)
    ).at(0);

    return row ? mapMessageRow(row) : undefined;
  }
}

import { and, asc, eq, gt, gte, lte, sql } from "drizzle-orm";
import {
  asAuthorId,
  asMessageId,
  asTimestampMs,
  type ChatId,
  type ChatMessage,
  type MessageId,
} from "@microsonya/shared";
import type { MicrosonyaDb } from "../client.js";
import type { DataEncryption } from "../encryption.js";
import { messages } from "../schema.js";

type MessageRow = typeof messages.$inferSelect;

function mapMessageRow(
  row: MessageRow,
  requestedChatId: ChatId,
  encryption: DataEncryption,
): ChatMessage {
  const author = Object.freeze({
    id: asAuthorId(row.authorId),
    label: encryption.decrypt(row.authorNameCiphertext),
  });

  return Object.freeze({
    id: asMessageId(row.messageId),
    chatId: requestedChatId,
    author,
    time: asTimestampMs(row.date),
    parentId:
      row.replyToMessageId === null ? null : asMessageId(row.replyToMessageId),
    text: encryption.decrypt(row.textCiphertext),
  });
}

export class MessagesRepo {
  constructor(
    private readonly db: MicrosonyaDb,
    private readonly encryption: DataEncryption,
  ) {}

  async save(message: ChatMessage): Promise<void> {
    const chatId = this.chatKey(message.chatId);
    await this.db.transaction(async (tx) => {
      await lockTelegramIngress(tx as MicrosonyaDb, chatId);
      await tx
        .insert(messages)
        .values({
          chatId,
          messageId: message.id,
          date: message.time,
          authorId: this.authorKey(message.author.id),
          authorNameCiphertext: this.encryption.encrypt(message.author.label),
          textCiphertext: this.encryption.encrypt(message.text),
          replyToMessageId: message.parentId,
          kind: "text",
          isCommand: false,
        })
        .onConflictDoUpdate({
          target: [messages.chatId, messages.messageId],
          set: {
            date: message.time,
            authorId: this.authorKey(message.author.id),
            authorNameCiphertext: this.encryption.encrypt(message.author.label),
            textCiphertext: this.encryption.encrypt(message.text),
            replyToMessageId: message.parentId,
            kind: "text",
            isCommand: false,
          },
        })
        .execute();
    });
  }

  async listByChat(chatId: ChatId): Promise<ChatMessage[]> {
    return (
      await this.db
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.chatId, this.chatKey(chatId)),
            eq(messages.kind, "text"),
            eq(messages.isCommand, false),
          ),
        )
        .orderBy(asc(messages.date), asc(messages.messageId))
    ).map((row) => mapMessageRow(row, chatId, this.encryption));
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
            eq(messages.chatId, this.chatKey(chatId)),
            gte(messages.messageId, fromMessageId),
            lte(messages.messageId, toMessageId),
            eq(messages.kind, "text"),
            eq(messages.isCommand, false),
          ),
        )
        .orderBy(asc(messages.date), asc(messages.messageId))
    ).map((row) => mapMessageRow(row, chatId, this.encryption));
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
            eq(messages.chatId, this.chatKey(chatId)),
            gt(messages.messageId, afterMessageId),
            eq(messages.kind, "text"),
            eq(messages.isCommand, false),
          ),
        )
        .orderBy(asc(messages.date), asc(messages.messageId))
        .limit(limit)
    ).map((row) => mapMessageRow(row, chatId, this.encryption));
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
            eq(messages.chatId, this.chatKey(chatId)),
            eq(messages.messageId, messageId),
            eq(messages.kind, "text"),
            eq(messages.isCommand, false),
          ),
        )
        .limit(1)
    ).at(0);

    return row ? mapMessageRow(row, chatId, this.encryption) : undefined;
  }

  private chatKey(chatId: ChatId): string {
    return this.encryption.lookup(chatId, "telegram-chat-id");
  }

  private authorKey(authorId: string): string {
    return this.encryption.lookup(authorId, "telegram-author-id");
  }
}

/** Serializes the short durable-ingress transaction for one Telegram chat. */
export async function lockTelegramIngress(
  db: MicrosonyaDb,
  encryptedChatId: string,
): Promise<void> {
  await db.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${encryptedChatId}, 0))`,
  );
}

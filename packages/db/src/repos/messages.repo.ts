import { and, asc, eq, gte, lte } from "drizzle-orm";
import type { ChatMessage } from "@microsonya/shared";
import type { MicrosonyaDb } from "../client.js";
import { messages } from "../schema.js";

type MessageRow = typeof messages.$inferSelect;

function mapMessageRow(row: MessageRow): ChatMessage {
  return {
    id: row.messageId,
    chatId: row.chatId,
    date: row.date,
    authorId: row.authorId,
    authorName: row.authorName ?? "",
    text: row.text ?? "",
    replyToId: row.replyToMessageId ?? undefined,
    kind: row.kind as ChatMessage["kind"],
    isCommand: row.isCommand,
  };
}

export class MessagesRepo {
  constructor(private readonly db: MicrosonyaDb) {}

  async save(message: ChatMessage): Promise<void> {
    await this.db
      .insert(messages)
      .values({
        chatId: message.chatId,
        messageId: message.id,
        date: message.date,
        authorId: message.authorId,
        authorName: message.authorName,
        text: message.text,
        replyToMessageId: message.replyToId,
        kind: message.kind,
        isCommand: message.isCommand ?? false,
      })
      .onConflictDoUpdate({
        target: [messages.chatId, messages.messageId],
        set: {
          date: message.date,
          authorId: message.authorId,
          authorName: message.authorName,
          text: message.text,
          replyToMessageId: message.replyToId,
          kind: message.kind,
          isCommand: message.isCommand ?? false,
        },
      })
      .execute();
  }

  async listByChat(chatId: string): Promise<ChatMessage[]> {
    return (
      await this.db
      .select()
      .from(messages)
      .where(eq(messages.chatId, chatId))
      .orderBy(asc(messages.messageId))
    ).map(mapMessageRow);
  }

  async listRangeByChat(
    chatId: string,
    fromMessageId: number,
    toMessageId: number,
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
        ),
      )
      .orderBy(asc(messages.messageId))
    ).map(mapMessageRow);
  }

  async find(chatId: string, messageId: number): Promise<ChatMessage | undefined> {
    const row = (
      await this.db
      .select()
      .from(messages)
      .where(
        and(eq(messages.chatId, chatId), eq(messages.messageId, messageId)),
      )
      .limit(1)
    ).at(0);

    return row ? mapMessageRow(row) : undefined;
  }
}

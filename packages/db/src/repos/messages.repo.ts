import { and, asc, eq } from "drizzle-orm";
import type { ChatMessage } from "@microsonya/shared";
import type { MicrosonyaDb } from "../client.js";
import { messages } from "../schema.js";

export class MessagesRepo {
  constructor(private readonly db: MicrosonyaDb) {}

  save(message: ChatMessage): void {
    this.db
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
        isCommand: message.isCommand ?? false
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
          isCommand: message.isCommand ?? false
        }
      })
      .run();
  }

  listByChat(chatId: string): ChatMessage[] {
    return this.db
      .select()
      .from(messages)
      .where(eq(messages.chatId, chatId))
      .orderBy(asc(messages.messageId))
      .all()
      .map((row) => ({
        id: row.messageId,
        chatId: row.chatId,
        date: row.date,
        authorId: row.authorId,
        authorName: row.authorName ?? "",
        text: row.text ?? "",
        replyToId: row.replyToMessageId ?? undefined,
        kind: row.kind as ChatMessage["kind"],
        isCommand: row.isCommand
      }));
  }

  find(chatId: string, messageId: number): ChatMessage | undefined {
    return this.db
      .select()
      .from(messages)
      .where(and(eq(messages.chatId, chatId), eq(messages.messageId, messageId)))
      .limit(1)
      .all()
      .map((row) => ({
        id: row.messageId,
        chatId: row.chatId,
        date: row.date,
        authorId: row.authorId,
        authorName: row.authorName ?? "",
        text: row.text ?? "",
        replyToId: row.replyToMessageId ?? undefined,
        kind: row.kind as ChatMessage["kind"],
        isCommand: row.isCommand
      }))[0];
  }
}

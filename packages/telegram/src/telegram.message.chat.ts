import {
  asAuthorId,
  asChatId,
  asMessageId,
  asTimestampMs,
  type ChatMessage,
} from "@microsonya/shared";
import { parseTelegramMessageUpdate } from "./telegram.message.js";

/** Converts an untrusted Telegram update to the canonical semantic message. */
export function parseTelegramChatMessageUpdate(
  input: unknown,
  selfAuthorId?: string,
): ChatMessage | undefined {
  const message = parseTelegramMessageUpdate(input);
  if (message === undefined) return undefined;
  const text = message.text ?? message.caption;
  if (
    !text?.trim() ||
    message.commandEntity !== undefined ||
    /^\s*\//u.test(text) ||
    message.author.id === selfAuthorId ||
    message.messageId <= 0
  )
    return undefined;
  const author = Object.freeze({
    id: asAuthorId(message.author.id),
    label: message.author.label,
  });
  return Object.freeze({
    id: asMessageId(message.messageId),
    chatId: asChatId(message.chatId),
    author,
    time: asTimestampMs(message.dateMs),
    parentId:
      message.replyToMessageId === undefined
        ? null
        : asMessageId(message.replyToMessageId),
    text,
  });
}

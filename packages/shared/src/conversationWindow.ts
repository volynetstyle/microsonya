import {
  asAuthorId,
  asChatId,
  asMessageId,
  asTimestampMs,
  type AuthorRef,
  type ChatId,
  type ChatMessage,
  type MessageId,
  type TimestampMs,
} from "./types.js";

const conversationWindowBrand: unique symbol = Symbol("ConversationWindow");

/**
 * The sole canonical observable conversation window.
 *
 * The private symbol makes construction outside this module impossible without
 * an explicit unsafe cast; callers must use createConversationWindow.
 */
export interface ConversationWindow {
  readonly chatId: ChatId;
  readonly messages: readonly ChatMessage[];
  readonly [conversationWindowBrand]: true;
}

/**
 * Creates an immutable chronological window and validates all runtime values.
 * Explicit parents are allowed to refer to messages outside the visible window.
 */
export function createConversationWindow(
  messages: readonly ChatMessage[],
): ConversationWindow {
  if (!Array.isArray(messages)) {
    throw new TypeError("ConversationWindow messages must be an array.");
  }

  if (messages.length === 0) {
    throw new TypeError(
      "ConversationWindow must contain at least one message.",
    );
  }

  const copiedMessages: ChatMessage[] = [];
  const seenIds = new Set<number>();
  let windowChatId: ChatId | undefined;
  let previousTime: TimestampMs | undefined;

  for (const [index, candidate] of messages.entries()) {
    const message = copyAndValidateMessage(candidate, index);

    if (windowChatId === undefined) {
      windowChatId = message.chatId;
    } else if (message.chatId !== windowChatId) {
      throw new TypeError(
        `ConversationWindow message at index ${index} belongs to a different chat.`,
      );
    }

    if (seenIds.has(message.id)) {
      throw new TypeError(
        `ConversationWindow contains duplicate message id ${message.id}.`,
      );
    }
    seenIds.add(message.id);

    if (previousTime !== undefined && message.time < previousTime) {
      throw new TypeError(
        `ConversationWindow messages are out of chronological order at index ${index}.`,
      );
    }
    previousTime = message.time;

    copiedMessages.push(message);
  }

  const immutableMessages = Object.freeze(copiedMessages);

  return Object.freeze({
    chatId: windowChatId!,
    messages: immutableMessages,
    [conversationWindowBrand]: true as const,
  });
}

function copyAndValidateMessage(
  candidate: ChatMessage,
  index: number,
): ChatMessage {
  if (typeof candidate !== "object" || candidate === null) {
    throw new TypeError(
      `ConversationWindow message at index ${index} must be an object.`,
    );
  }

  const id = asMessageId(candidate.id);
  const chatId = asChatId(candidate.chatId);
  const time = asTimestampMs(candidate.time);
  const parentId = validateParentId(candidate.parentId, index);
  const author = copyAndValidateAuthor(candidate.author, index);

  if (typeof candidate.text !== "string") {
    throw new TypeError(
      `ConversationWindow message text at index ${index} must be a string.`,
    );
  }

  return Object.freeze({
    id,
    chatId,
    author,
    time,
    parentId,
    text: candidate.text,
  });
}

function copyAndValidateAuthor(author: AuthorRef, index: number): AuthorRef {
  if (typeof author !== "object" || author === null) {
    throw new TypeError(
      `ConversationWindow message author at index ${index} must be an object.`,
    );
  }

  if (typeof author.label !== "string" || author.label.trim().length === 0) {
    throw new TypeError(
      `ConversationWindow author label at index ${index} must be a non-empty string.`,
    );
  }

  return Object.freeze({
    id: asAuthorId(author.id),
    label: author.label,
  });
}

function validateParentId(
  parentId: MessageId | null,
  index: number,
): MessageId | null {
  if (parentId === null) {
    return null;
  }

  try {
    return asMessageId(parentId);
  } catch {
    throw new TypeError(
      `ConversationWindow parent id at index ${index} must be null or a valid MessageId.`,
    );
  }
}

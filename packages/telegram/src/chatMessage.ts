import {
  asAuthorId,
  asChatId,
  asMessageId,
  asTimestampMs,
  type ChatMessage,
} from "@microsonya/shared";
type RecordValue = Record<string, unknown>;

/** Converts an untrusted Telegram update to the canonical semantic message. */
export function parseTelegramChatMessageUpdate(
  input: unknown,
  selfAuthorId?: string,
): ChatMessage | undefined {
  const update = record(input);
  const message = record(update?.message);
  const chat = record(message?.chat);
  if (!message || !chat) return undefined;
  const messageId = positiveInteger(message.message_id);
  const date = nonNegativeInteger(message.date);
  const chatId = identifier(chat.id);
  const text =
    typeof message.text === "string"
      ? message.text
      : typeof message.caption === "string"
        ? message.caption
        : undefined;
  if (
    !messageId ||
    date === undefined ||
    !chatId ||
    !text?.trim() ||
    isControlMessage(message, text)
  )
    return undefined;
  const author = actor(record(message.from) ?? chat);
  if (author.id === selfAuthorId) return undefined;
  const contentSource = forwardedSource(message);
  if (
    contentSource !== undefined &&
    "sourceId" in contentSource &&
    contentSource.sourceId === selfAuthorId
  )
    return undefined;
  const parentId = positiveInteger(
    record(message.reply_to_message)?.message_id,
  );
  return Object.freeze({
    id: asMessageId(messageId),
    chatId: asChatId(chatId),
    author: Object.freeze({ id: asAuthorId(author.id), label: author.label }),
    ...(contentSource === undefined ? {} : { contentSource }),
    time: asTimestampMs(date * 1_000),
    parentId: parentId === undefined ? null : asMessageId(parentId),
    text,
  });
}
function isControlMessage(message: RecordValue, text: string): boolean {
  if (/^\s*\//u.test(text)) return true;
  return (
    Array.isArray(message.entities) &&
    message.entities.some((value) => {
      const entity = record(value);
      return entity?.type === "bot_command" && entity.offset === 0;
    })
  );
}
function forwardedSource(message: RecordValue): ChatMessage["contentSource"] {
  const origin = record(message.forward_origin);
  const user = record(origin?.sender_user ?? message.forward_from);
  if (user) return sourceActor("forwarded_user", user);
  const forwardedChat = record(
    origin?.sender_chat ?? origin?.chat ?? message.forward_from_chat,
  );
  if (forwardedChat) return sourceActor("channel", forwardedChat);
  const hidden =
    typeof origin?.sender_user_name === "string"
      ? origin.sender_user_name
      : typeof message.forward_sender_name === "string"
        ? message.forward_sender_name
        : undefined;
  if (hidden) return { kind: "forwarded_user", label: hidden };
  return undefined;
}
function sourceActor(
  kind: "forwarded_user" | "channel",
  value: RecordValue,
): NonNullable<ChatMessage["contentSource"]> {
  const identity = actor(value);
  return {
    kind,
    sourceId: identity.id,
    label: identity.label,
    ...(typeof value.username === "string" && value.username.length > 0
      ? { username: value.username }
      : {}),
  };
}
function actor(value: RecordValue): { id: string; label: string } {
  const id = identifier(value.id) ?? "unknown";
  const names = [value.title, value.first_name, value.last_name].filter(
    (part): part is string => typeof part === "string" && part.length > 0,
  );
  const username =
    typeof value.username === "string" && value.username.length > 0
      ? value.username
      : undefined;
  return { id, label: names.join(" ") || (username ? `@${username}` : id) };
}
function record(value: unknown): RecordValue | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as RecordValue)
    : undefined;
}
function positiveInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) > 0
    ? (value as number)
    : undefined;
}
function nonNegativeInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) >= 0
    ? (value as number)
    : undefined;
}
function identifier(value: unknown): string | undefined {
  return typeof value === "string" || Number.isSafeInteger(value)
    ? String(value)
    : undefined;
}

type RecordValue = Record<string, unknown>;

export type TelegramChatType = "private" | "group" | "supergroup" | "channel";
export interface TelegramActor {
  readonly id: string;
  readonly label: string;
}
export interface TelegramCommandEntity {
  readonly offset: number;
  readonly length: number;
}
export interface TelegramMessage {
  readonly updateId: number;
  readonly messageId: number;
  readonly dateMs: number;
  readonly chatId: string;
  readonly chatType: TelegramChatType;
  readonly senderUserId?: number;
  readonly messageThreadId?: number;
  readonly ephemeralMessageId?: number;
  readonly replyToMessageId?: number;
  readonly text?: string;
  readonly caption?: string;
  readonly commandEntity?: TelegramCommandEntity;
  readonly forwarded: boolean;
  readonly author: TelegramActor;
}



export function parseTelegramMessageUpdate(
  input: unknown,
): TelegramMessage | undefined {
  const update = record(input),
    message = record(update?.message),
    chat = record(message?.chat);
  if (!update || !message || !chat) return undefined;
  const updateId = nonNegativeInteger(update.update_id);
  const messageId = nonNegativeInteger(message.message_id);
  const date = positiveInteger(message.date);
  const chatId = identifier(chat.id),
    chatType = telegramChatType(chat.type);
  if (
    updateId === undefined ||
    messageId === undefined ||
    date === undefined ||
    chatId === undefined ||
    chatType === undefined
  )
    return undefined;
  const messageThreadId = optionalInteger(
    message.message_thread_id,
    positiveInteger,
  );
  const ephemeralMessageId = optionalInteger(
    message.ephemeral_message_id,
    nonNegativeInteger,
  );
  if (messageThreadId === invalid || ephemeralMessageId === invalid)
    return undefined;
  const senderUserId = positiveInteger(record(message.from)?.id);
  const replyToMessageId = positiveInteger(
    record(message.reply_to_message)?.message_id,
  );
  const commandEntity = findCommandEntity(message.entities);
  return {
    updateId,
    messageId,
    dateMs: date * 1_000,
    chatId,
    chatType,
    ...(senderUserId === undefined ? {} : { senderUserId }),
    ...(messageThreadId === undefined ? {} : { messageThreadId }),
    ...(ephemeralMessageId === undefined ? {} : { ephemeralMessageId }),
    ...(replyToMessageId === undefined ? {} : { replyToMessageId }),
    ...(typeof message.text === "string" ? { text: message.text } : {}),
    ...(typeof message.caption === "string"
      ? { caption: message.caption }
      : {}),
    ...(commandEntity === undefined ? {} : { commandEntity }),
    forwarded: message.forward_origin !== undefined,
    author: messageAuthor(message, chat),
  };
}

const invalid = Symbol("invalid optional integer");
function optionalInteger(
  value: unknown,
  parser: (value: unknown) => number | undefined,
): number | undefined | typeof invalid {
  return value === undefined ? undefined : (parser(value) ?? invalid);
}
function findCommandEntity(value: unknown): TelegramCommandEntity | undefined {
  if (!Array.isArray(value)) return undefined;
  for (const candidate of value) {
    const entity = record(candidate);
    if (entity?.type !== "bot_command") continue;
    const offset = nonNegativeInteger(entity.offset),
      length = positiveInteger(entity.length);
    if (offset === 0 && length !== undefined) return { offset, length };
  }
  return undefined;
}
function messageAuthor(message: RecordValue, chat: RecordValue): TelegramActor {
  const origin = record(message.forward_origin);
  const source = record(
    origin?.sender_user ?? origin?.sender_chat ?? origin?.chat,
  );
  if (source) return actor(source);
  if (typeof origin?.sender_user_name === "string")
    return { id: origin.sender_user_name, label: origin.sender_user_name };
  return actor(record(message.sender_chat) ?? record(message.from) ?? chat);
}
function actor(value: RecordValue): TelegramActor {
  const id = identifier(value.id) ?? "unknown";
  const parts = [
    value.title,
    value.first_name,
    value.last_name,
    value.username,
  ].filter(
    (part): part is string => typeof part === "string" && part.length > 0,
  );
  return { id, label: parts.join(" ") || id };
}
function record(value: unknown): RecordValue | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as RecordValue)
    : undefined;
}
function safeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : undefined;
}
function positiveInteger(value: unknown): number | undefined {
  const number = safeInteger(value);
  return number !== undefined && number > 0 ? number : undefined;
}
function nonNegativeInteger(value: unknown): number | undefined {
  const number = safeInteger(value);
  return number !== undefined && number >= 0 ? number : undefined;
}
function identifier(value: unknown): string | undefined {
  return typeof value === "string" || Number.isSafeInteger(value)
    ? String(value)
    : undefined;
}
function telegramChatType(value: unknown): TelegramChatType | undefined {
  return value === "private" ||
    value === "group" ||
    value === "supergroup" ||
    value === "channel"
    ? value
    : undefined;
}

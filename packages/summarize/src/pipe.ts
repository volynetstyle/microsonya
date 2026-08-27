import type {
  AuthorId,
  ChatMessage,
  ConversationWindow,
} from "@microsonya/shared";

export const PIPE_SEPARATOR = "|";

/** The sole ordered PIPECHAT schema. The guide and encoder derive from it. */
export const PIPE_FIELDS = [
  "#ID",
  "^PARENT",
  "AUTHOR",
  "TIME",
  "MESSAGE",
] as const;

export const PIPE_HEADER = PIPE_FIELDS.join(PIPE_SEPARATOR);

/**
 * PIPECHAT is the canonical model-facing serialization of W.
 *
 *   P = encodePipe(W)
 *
 * W remains the canonical observable conversation window. PIPECHAT introduces
 * no additional semantic information.
 *
 * Each encoded message follows the sole ordered tuple:
 *
 *   mi = (
 *     id,
 *     replyParent,
 *     author,
 *     time,
 *     text
 *   )
 *
 * The reply edge `mi -> mj` means only that mi explicitly replies to mj. It
 * does not establish causality, agreement, contradiction, identity, or any
 * other semantic relation.
 */
export const PIPE_GUIDE = [
  PIPE_HEADER,
  "",
  "Lines are chronological.",
  "",
  "#N identifies message N.",
  "^0 means no explicit parent.",
  "^N means the message explicitly replies to message #N.",
  "The parent message may be outside the visible window if #N is not present.",
  "",
  "AUTHOR and MESSAGE are JSON-encoded strings.",
  "AUTHOR starts with a stable window-local alias; source user IDs are hidden.",
  "TIME is normalized ISO 8601 UTC.",
  "",
  "Parent structure provides conversational context but does not by itself prove",
  "causality, agreement, contradiction, or any other semantic relation.",
].join("\n");

/**
 * Encodes one immutable ConversationWindow for every model-facing consumer.
 * Author aliases are stable by first appearance and distinguish equal labels.
 */
export function encodePipeWindow(window: ConversationWindow): string {
  const aliases = assignAuthorAliases(window);

  return window.messages
    .map((message) =>
      encodePipeMessage(message, aliases.get(message.author.id)!),
    )
    .join("\n");
}

function assignAuthorAliases(
  window: ConversationWindow,
): ReadonlyMap<AuthorId, string> {
  const aliases = new Map<AuthorId, string>();

  for (const message of window.messages) {
    if (!aliases.has(message.author.id)) {
      aliases.set(message.author.id, `@${aliases.size + 1}`);
    }
  }

  return aliases;
}

function encodePipeMessage(message: ChatMessage, alias: string): string {
  return [
    `#${message.id}`,
    `^${message.parentId ?? 0}`,
    encodeString(
      message.author.label.length > 0
        ? `${alias} ${message.author.label}`
        : alias,
    ),
    encodeTime(message.time),
    encodeString(message.text),
  ].join(PIPE_SEPARATOR);
}

/** Rejects every fixed-schema PIPECHAT record violation. */
export function validatePipeRecord(record: string): void {
  const fields = record.split(PIPE_SEPARATOR);
  if (fields.length !== PIPE_FIELDS.length) {
    throw new Error(
      `Invalid PIPECHAT record: expected ${PIPE_FIELDS.length} fields, got ${fields.length}.`,
    );
  }

  const [idField, parentField, authorField, timeField, messageField] = fields;
  parsePrefixedInteger(idField!, "#", "ID", false);
  parsePrefixedInteger(parentField!, "^", "parent", true);
  parseJsonString(authorField!, "AUTHOR");
  parseTime(timeField!);
  parseJsonString(messageField!, "MESSAGE");
}

function encodeString(value: string): string {
  return JSON.stringify(value).replaceAll(PIPE_SEPARATOR, "\\u007c");
}

function encodeTime(timestamp: number): string {
  return new Date(timestamp).toISOString().replace(".000Z", "Z");
}

function parsePrefixedInteger(
  value: string,
  prefix: string,
  label: string,
  allowsZero: boolean,
): number {
  if (!value.startsWith(prefix)) {
    throw new Error(`Invalid PIPECHAT ${label}: ${value}`);
  }

  const number = value.slice(prefix.length);
  const parsed = Number(number);
  if (!Number.isSafeInteger(parsed) || parsed < (allowsZero ? 0 : 1)) {
    throw new Error(`Invalid PIPECHAT ${label}: ${value}`);
  }
  if (String(parsed) !== number) {
    throw new Error(`Invalid PIPECHAT ${label}: ${value}`);
  }

  return parsed;
}

function parseJsonString(value: string, label: string): string {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "string") throw new Error("not a string");
    return parsed;
  } catch {
    throw new Error(`Invalid PIPECHAT ${label}: expected a JSON string.`);
  }
}

function parseTime(value: string): number {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || encodeTime(timestamp) !== value) {
    throw new Error(`Invalid PIPECHAT TIME: ${value}`);
  }
  return timestamp;
}

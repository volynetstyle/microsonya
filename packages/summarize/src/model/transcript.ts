import type { ConversationWindow } from "@microsonya/shared";

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
  "AUTHOR is the visible author label; source user IDs are hidden.",
  "Use that visible label for attribution; never invent or emit internal author IDs.",
  "TIME is normalized ISO 8601 UTC.",
  "",
  "Parent structure provides conversational context but does not by itself prove",
  "causality, agreement, contradiction, or any other semantic relation.",
  "When INPUT_ROLES is present, context-only messages resolve references only.",
  "Do not treat context-only messages as new events to classify or summarize.",
].join("\n");

/**
 * Encodes one immutable ConversationWindow for every model-facing consumer.
 * Only visible author labels cross the model boundary. Internal identities stay
 * private and cannot leak into generated text as synthetic @N aliases.
 */
export function encodePipeWindow(window: ConversationWindow): string {
  const { messages } = window;
  const records = new Array<string>(messages.length);

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]!;
    records[index] =
      `#${message.id}|^${message.parentId ?? 0}|${encodePipeString(message.author.label)}|${encodePipeTime(message.time)}|${encodePipeString(message.text)}`;
  }

  return records.join("\n");
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
  parsePipeTime(timeField!);
  parseJsonString(messageField!, "MESSAGE");
}

function encodePipeString(value: string): string {
  const encoded = JSON.stringify(value);
  return encoded.includes(PIPE_SEPARATOR)
    ? encoded.replaceAll(PIPE_SEPARATOR, "\\u007c")
    : encoded;
}

function encodePipeTime(timestamp: number): string {
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

function parsePipeTime(value: string): number {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || encodePipeTime(timestamp) !== value) {
    throw new Error(`Invalid PIPECHAT TIME: ${value}`);
  }
  return timestamp;
}

import type { ChatMessage } from "@microsonya/shared";

export const PIPE_SEPARATOR = "|";

export type PipeMessage = {
  id: number;
  parentId?: number;
  author: string;
  time: number;
  message: string;
};

type PipeField = {
  readonly name: string;
  readonly encode: (message: PipeMessage) => string;
};

/** The sole ordered schema for both the human guide and encoded records. */
export const PIPE_FIELDS = [
  { name: "#ID", encode: (message) => `#${message.id}` },
  { name: "^PARENT", encode: (message) => `^${message.parentId ?? 0}` },
  { name: "AUTHOR", encode: (message) => encodeString(message.author) },
  { name: "TIME", encode: (message) => encodeTime(message.time) },
  { name: "MESSAGE", encode: (message) => encodeString(message.message) },
] as const satisfies readonly PipeField[];

export const PIPE_HEADER = PIPE_FIELDS.map((field) => field.name).join(
  PIPE_SEPARATOR,
);

/**
 * PIPECHAT is the observable representation W.
 *
 * Each line preserves only information available to the summarizer:
 *
 *   mi = (
 *     id,
 *     author,
 *     time,
 *     replyParent,
 *     text
 *   )
 *
 * and:
 *
 *   W = [m1, m2, ..., mn]
 *
 * The reply edge:
 *
 *   mi → mj
 *
 * means only "mi explicitly replies to mj".
 *
 * It does NOT establish:
 *
 *   causal(mi, mj)
 *   agrees(mi, mj)
 *   contradicts(mi, mj)
 *   refersToSameThing(mi, mj)
 *
 * Those require semantic evidence from text.
 *
 * Keeping this distinction explicit prevents graph structure from silently
 * becoming semantic evidence.
 */
export const PIPE_GUIDE = [
  PIPE_HEADER,
  "",
  "Lines are chronological.",
  "",
  "#N identifies message N.",
  "^0 means no explicit parent.",
  "^N means message #N is the explicit parent.",
  "",
  "AUTHOR and MESSAGE are JSON-encoded strings.",
  "TIME is normalized ISO 8601 UTC.",
  "",
  "Parent structure provides conversational context but does not by itself prove",
  "causality, agreement, contradiction, or any other semantic relation.",
].join("\n");

export function encodePipe(messages: readonly ChatMessage[]): string {
  return messages
    .map((message) =>
      encodePipeRecord({
        id: message.id,
        parentId: message.replyToId,
        author: message.authorName || message.authorId,
        time: message.date,
        message: message.text,
      }),
    )
    .join("\n");
}

export function encodePipeRecord(message: PipeMessage): string {
  return PIPE_FIELDS.map((field) => field.encode(message)).join(PIPE_SEPARATOR);
}

/** Decodes one record and rejects every format invariant violation. */
export function decodePipeRecord(record: string): PipeMessage {
  const fields = record.split(PIPE_SEPARATOR);
  if (fields.length !== PIPE_FIELDS.length) {
    throw new Error(
      `Invalid PIPECHAT record: expected ${PIPE_FIELDS.length} fields, got ${fields.length}.`,
    );
  }

  const [idField, parentField, authorField, timeField, messageField] = fields;
  const id = parsePrefixedInteger(idField!, "#", "ID", false);
  const parentId = parsePrefixedInteger(parentField!, "^", "parent", true);
  const author = parseJsonString(authorField!, "AUTHOR");
  const time = parseTime(timeField!);
  const message = parseJsonString(messageField!, "MESSAGE");

  return { id, parentId: parentId || undefined, author, time, message };
}

export function validatePipeRecord(record: string): void {
  decodePipeRecord(record);
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
  if (!value.startsWith(prefix))
    throw new Error(`Invalid PIPECHAT ${label}: ${value}`);
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

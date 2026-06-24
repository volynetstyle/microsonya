import { createHash } from "node:crypto";
import type { ChatMessage } from "@microsonya/shared";

const NULL = "\x00";
const SEP = "\x1f";

function updateField(
  hash: ReturnType<typeof createHash>,
  value: unknown,
): void {
  if (value === null || value === undefined) {
    hash.update(NULL);
    hash.update(SEP);
    return;
  }

  const str = value instanceof Date ? value.toISOString() : String(value);
  const byteLength = Buffer.byteLength(str, "utf8");

  hash.update(String(byteLength));
  hash.update(":");
  hash.update(str, "utf8");
  hash.update(SEP);
}

function updateMessageHash(
  hash: ReturnType<typeof createHash>,
  message: ChatMessage,
): void {
  updateField(hash, message.id);
  updateField(hash, message.date);
  updateField(hash, message.authorId);
  updateField(hash, message.text);
  updateField(hash, message.replyToId ?? null);
  updateField(hash, message.kind);
}

export function hashMessages(messages: readonly ChatMessage[]): string {
  const hash = createHash("sha256");

  // Format version. Very useful when you change the scheme later,
  // and old caches will start looking at you as the culprit of the war.
  hash.update("chat-messages-v1");
  hash.update(SEP);

  updateField(hash, messages.length);

  for (const message of messages) {
    updateMessageHash(hash, message);
  }

  return hash.digest("hex");
}

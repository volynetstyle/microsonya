import { createHash } from "node:crypto";
import type { ChatMessage } from "@microsonya/shared";

const ENCD = "utf8";
const NULL = "\0";
const SEP = "\u001F";

function updateField(
  hash: ReturnType<typeof createHash>,
  value: unknown,
): void {
  if (value === null || value === undefined) {
    hash.update(NULL);
    hash.update(SEP);
    return;
  }

  const str = value instanceof Date ? value.toISOString() : value + "";
  const byteLength = Buffer.byteLength(str, ENCD);

  // Length-prefix each field instead of relying only on separators.
  // This prevents ambiguous concatenation cases like:
  //   ["ab", "c"] vs ["a", "bc"]
  //
  // The format is not meant to be decoded later. It is only a stable,
  // unambiguous byte stream for hashing.
  // X + "" just fast
  hash.update(byteLength + "");
  hash.update(":");
  hash.update(str, ENCD);
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

  // Format version.
  //
  // If the hash schema changes later, bump this value instead of silently
  // producing hashes that look compatible but mean something different.
  // Future-you will still suffer, but at least with a version number.
  hash.update("chat-messages-v1");
  hash.update(SEP);

  // Include the number of messages so that the message sequence shape is part
  // of the hash, not only the raw field stream.
  updateField(hash, messages.length);

  // This is a full snapshot hash:
  //
  //   cost: O(number of messages + total text size)
  //
  // It intentionally recomputes the hash from the whole ordered list. That makes
  // the result simple, deterministic, order-sensitive, and independent from any
  // cached per-message state.
  //
  // For the expected chat window size, around 500-1000 messages, this is usually
  // a good trade-off:
  //
  // - no intermediate array from messages.map(...)
  // - no giant JSON.stringify(payload) allocation
  // - no per-message hash cache to keep in sync
  // - no XOR aggregate collision/order pitfalls
  // - no Merkle tree complexity
  //
  // Alternatives:
  //
  // 1. Per-message hash + XOR aggregate
  //    - O(1) update when one message is edited
  //    - good for runtime dirty-checks
  //    - does not preserve order unless position/version is included
  //    - weaker collision behavior
  //
  // 2. Per-message hash + Merkle/segment tree
  //    - O(log n) update
  //    - order-sensitive
  //    - better for large lists or frequent edits
  //    - more code, more state, more ways for humans to ruin a Tuesday
  //
  // 3. Full SHA-256 snapshot, used here
  //    - O(n), but very simple and robust
  //    - good while the list is small/medium and hashing is not on a hot path
  //    - should be revisited if message count grows significantly, messages
  //      become very large, or edits happen at high frequency
  for (const message of messages) {
    updateMessageHash(hash, message);
  }

  return hash.digest("hex");
}

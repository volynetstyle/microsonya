import type { SummaryAttempt, SummaryInputIdentity } from "@microsonya/shared";
import { createHash } from "node:crypto";
import { CHECKPOINT_POLICY_VERSION } from "./window/consumption.js";
import type {
  SelectedConversation,
  WindowMessage,
} from "./window/selection.js";

/** Bump when summary/classification semantics cease to be reusable. */
export const SUMMARY_POLICY_VERSION = `summary-policy-v3-grounded-fragments-reviewed:${CHECKPOINT_POLICY_VERSION}`;

export const SUMMARY_POLICY_HASH = sha256(SUMMARY_POLICY_VERSION);

export function snapshotMessages(
  messages: readonly WindowMessage[],
): SummaryAttempt["messages"] {
  return messages.map(({ message, role }, ordinal) => ({
    ordinal,
    chatId: message.chatId,
    messageId: message.id,
    role,
    authorId: message.author.id,
    authorName: message.author.label,
    text: message.text,
    sentAt: message.time,
    replyToId: message.parentId,
  }));
}

export function hashSummaryInput(messages: SummaryAttempt["messages"]): string {
  return sha256(JSON.stringify(messages));
}

export function identifySummaryInput(
  selected: SelectedConversation,
): SummaryInputIdentity {
  const snapshots = snapshotMessages(selected.messages);
  return {
    scope: selected.window.chatId,
    start: selected.eligibleMessages[0]!.id,
    end: selected.upperExclusive,
    eligibleCount: selected.eligibleMessages.length,
    inputHash: hashSummaryInput(snapshots),
    policyHash: SUMMARY_POLICY_HASH,
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

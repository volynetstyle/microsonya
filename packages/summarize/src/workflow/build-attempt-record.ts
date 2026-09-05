import { createHash } from "node:crypto";
import type {
  MessageId,
  SummaryAction,
  SummaryAttempt,
} from "@microsonya/shared";
import type { WindowMessage } from "../selection/select-conversation.js";
import { CHECKPOINT_POLICY_VERSION } from "../acceptance/consumption-policy.js";
import type { SummaryErrorCode } from "./telemetry.js";

export type BuildAttemptRecordInput = Omit<
  SummaryAttempt,
  "policyHash" | "inputHash" | "messages" | "candidate"
> & {
  readonly selectedMessages: readonly WindowMessage[];
  readonly checkpointBefore: MessageId | null;
  readonly consecutiveDeferCount: number;
  readonly action?: SummaryAction;
  readonly status: SummaryAttempt["status"];
  readonly errorCode?: SummaryErrorCode;
};

/** Pure workflow transition from execution evidence to its durable record. */
export function buildAttemptRecord(
  input: BuildAttemptRecordInput,
): SummaryAttempt {
  const messages = snapshotMessages(input.selectedMessages);
  const inputHash = sha256(JSON.stringify(messages));
  const {
    selectedMessages: _selectedMessages,
    consecutiveDeferCount,
    ...record
  } = input;
  return Object.freeze({
    ...record,
    policyHash: sha256(CHECKPOINT_POLICY_VERSION),
    inputHash,
    messages,
    candidate: mineDatasetCandidate({
      action: input.action,
      status: input.status,
      consecutiveDeferCount,
      snapshots: messages,
      inputHash,
    }),
  });
}

function snapshotMessages(
  messages: readonly WindowMessage[],
): SummaryAttempt["messages"] {
  return Object.freeze(
    messages.map(({ message, role }, ordinal) =>
      Object.freeze({
        ordinal,
        chatId: message.chatId,
        messageId: message.id,
        role,
        authorId: message.author.id,
        authorName: message.author.label,
        text: message.text,
        sentAt: message.time,
        replyToId: message.parentId,
      }),
    ),
  );
}

function mineDatasetCandidate(input: {
  action?: SummaryAction;
  status: SummaryAttempt["status"];
  consecutiveDeferCount: number;
  snapshots: SummaryAttempt["messages"];
  inputHash: string;
}): SummaryAttempt["candidate"] {
  const reasons = new Set<string>();
  let priority = 0;
  const eligibleText: string[] = [];
  let hasReplyContext = false;
  for (const snapshot of input.snapshots) {
    if (snapshot.role === "eligible") eligibleText.push(snapshot.text);
    else hasReplyContext = true;
  }
  const joinedEligibleText = eligibleText.join("\n");
  if (input.status === "error") {
    reasons.add("RUN_ERROR");
    priority += 100;
  }
  if (input.consecutiveDeferCount >= 3) {
    reasons.add("DEFER_STREAK");
    priority += input.consecutiveDeferCount * 10;
  }
  if (hasReplyContext) {
    reasons.add("REPLY_PROVENANCE");
    priority += 5;
  }
  const numericTokens = joinedEligibleText.match(/\b\d+(?:[.:,]\d+)?\b/g) ?? [];
  if (numericTokens.length >= 3) {
    reasons.add("NUMERIC_RICH");
    priority += 5;
  }
  if (
    input.action?.startsWith("SKIP_") &&
    (joinedEligibleText.length >= 500 || numericTokens.length >= 3)
  ) {
    reasons.add("SKIP_HIGH_INFORMATION");
    priority += 100;
  }
  const sampleBucket = Number.parseInt(input.inputHash.slice(0, 8), 16) % 100;
  if (reasons.size === 0) {
    const sampleRate = input.status === "deferred" ? 20 : 3;
    if (sampleBucket < sampleRate) {
      reasons.add(
        input.status === "deferred" ? "BOUNDARY_SAMPLE" : "NORMAL_SAMPLE",
      );
      priority += 1;
    }
  }
  return reasons.size === 0
    ? undefined
    : Object.freeze({ priority, reasons: Object.freeze([...reasons]) });
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

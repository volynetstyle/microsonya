import type {
  MessageId,
  SummaryAction,
  SummaryAttempt,
} from "@microsonya/shared";
import {
  hashSummaryInput,
  snapshotMessages,
  SUMMARY_POLICY_HASH,
} from "../summary.input.js";
import type { WindowMessage } from "../window/selection.js";
import { mineDatasetCandidate } from "./dataset.js";
import type { SummaryErrorCode } from "./events.js";

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
  const inputHash = hashSummaryInput(messages);
  const {
    selectedMessages: _selectedMessages,
    consecutiveDeferCount,
    ...record
  } = input;
  return {
    ...record,
    policyHash: SUMMARY_POLICY_HASH,
    inputHash,
    messages,
    candidate: mineDatasetCandidate({
      action: input.action,
      status: input.status,
      consecutiveDeferCount,
      snapshots: messages,
      inputHash,
    }),
  };
}

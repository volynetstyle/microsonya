import type {
  AcceptedOutcomeRecord,
  SkipReason,
  SummaryId,
  SummaryInputIdentity,
  TimestampMs,
  WindowDisposition,
} from "@microsonya/shared";
import type { SummaryAttemptStore } from "../summary.dependencies.js";
import { coverageOf } from "../window/coverage.js";
import type { SelectedConversation } from "../window/selection.js";

export function findReusableOutcome(
  store: SummaryAttemptStore,
  identity: SummaryInputIdentity,
): Promise<AcceptedOutcomeRecord | undefined> {
  return store.findReusableOutcome?.(identity) ?? Promise.resolve(undefined);
}

export function dispositionFromReusableOutcome(
  outcome: AcceptedOutcomeRecord,
  selected: SelectedConversation,
  createSummaryId: () => SummaryId,
  now: () => TimestampMs,
): Exclude<WindowDisposition, { kind: "deferred" }> {
  if (outcome.status === "summarized") {
    return {
      kind: "summarized" as const,
      summary: {
        id: createSummaryId(),
        chatId: selected.window.chatId,
        covers: coverageOf(selected.eligibleMessages),
        text: outcome.finalText,
        createdAt: now(),
      },
    };
  }
  if (!outcome.action.startsWith("SKIP_")) {
    throw new TypeError("Reusable skipped outcome has a non-skip action.");
  }
  return {
    kind: "skipped" as const,
    reason: outcome.action as SkipReason,
  };
}

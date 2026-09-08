import type { AcceptedOutcomeRecord } from "@microsonya/shared";
import type { SummaryAttemptStore } from "../summary.dependencies.js";

export function recordAcceptedOutcome(
  store: SummaryAttemptStore,
  outcome: AcceptedOutcomeRecord,
): Promise<void> {
  const record = store.recordAcceptedOutcome;
  if (record === undefined) {
    throw new TypeError(
      "Summary attempt store cannot record accepted outcome.",
    );
  }
  return record.call(store, outcome);
}

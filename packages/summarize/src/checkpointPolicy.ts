import type { SummaryAction } from "@microsonya/shared";

export type SummaryOutcome = "success" | "failure";

/** Fingerprint source for persisted evidence; changing it is a policy change. */
export const CHECKPOINT_POLICY_VERSION = "checkpoint-policy-v0.1";

/**
 * Defines the irreversible checkpoint transition independently from persistence.
 * Deferred and empty windows remain eligible; intentional skips and successful
 * summaries consume the visible window.
 */
export function shouldAdvanceCheckpoint(
  action: SummaryAction | "EMPTY",
  outcome: SummaryOutcome = "success",
): boolean {
  if (action === "EMPTY" || action.startsWith("DEFER_")) return false;
  if (action === "SUMMARIZE") return outcome === "success";
  return true;
}

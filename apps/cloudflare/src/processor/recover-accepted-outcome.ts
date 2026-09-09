import type { AcceptedOutcome, DeferReason } from "@microsonya/shared";
import {
  createSummaryWorkflow,
  presentDisposition,
} from "@microsonya/summarize";
import { EMPTY_SUMMARY_MESSAGE } from "./policy.js";

export function presentAcceptedOutcome(outcome: AcceptedOutcome): string {
  if (outcome.kind === "summarized") return outcome.text;
  if (outcome.kind === "empty") return EMPTY_SUMMARY_MESSAGE;
  if (outcome.kind === "deferred") {
    return presentDisposition({
      kind: "deferred",
      reason: outcome.reason as DeferReason,
    });
  }
  return presentDisposition({ kind: "skipped", reason: outcome.reason });
}

export function presentGeneratedDisposition(
  disposition:
    | Awaited<ReturnType<ReturnType<typeof createSummaryWorkflow>["process"]>>
    | string,
): string {
  if (typeof disposition === "string") return disposition;
  return disposition === null
    ? EMPTY_SUMMARY_MESSAGE
    : presentDisposition(disposition);
}

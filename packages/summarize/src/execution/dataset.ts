import type { SummaryAction, SummaryAttempt } from "@microsonya/shared";

export function mineDatasetCandidate(input: {
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
  return reasons.size === 0 ? undefined : { priority, reasons: [...reasons] };
}

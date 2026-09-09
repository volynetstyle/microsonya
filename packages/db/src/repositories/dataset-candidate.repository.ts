import type { SummaryAttempt } from "@microsonya/shared";
import type { MicrosonyaDb } from "../client.js";
import { datasetCandidates } from "../schema.js";

export async function insertDatasetCandidate(
  db: Pick<MicrosonyaDb, "insert">,
  attempt: Pick<SummaryAttempt, "id" | "completedAt" | "candidate">,
): Promise<void> {
  if (attempt.candidate === undefined) return;
  await db.insert(datasetCandidates).values({
    runId: attempt.id,
    priority: attempt.candidate.priority,
    reasons: [...attempt.candidate.reasons],
    status: "pending",
    createdAt: attempt.completedAt,
  });
}

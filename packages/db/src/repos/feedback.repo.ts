import { eq } from "drizzle-orm";
import type { SummaryFeedback } from "@microsonya/shared";
import type { MicrosonyaDb } from "../client.js";
import type { LedgerEncryption } from "../encryption.js";
import { datasetCandidates, summaryFeedback } from "../schema.js";

export class SummaryFeedbackRepo {
  constructor(
    private readonly db: MicrosonyaDb,
    private readonly encryption: LedgerEncryption,
  ) {}

  async save(feedback: SummaryFeedback): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.insert(summaryFeedback).values({
        id: feedback.id,
        runId: feedback.runId,
        source: feedback.source,
        signal: feedback.signal,
        comment: feedback.comment,
        correctedSummaryCiphertext:
          feedback.correctedSummary === undefined
            ? null
            : this.encryption.encrypt(feedback.correctedSummary),
        createdAt: feedback.createdAt,
      });

      const reason =
        feedback.signal === "bad"
          ? "NEGATIVE_FEEDBACK"
          : feedback.signal === "corrected"
            ? "USER_CORRECTION"
            : undefined;
      if (reason === undefined) return;

      const existing = (
        await tx
          .select()
          .from(datasetCandidates)
          .where(eq(datasetCandidates.runId, feedback.runId))
          .limit(1)
      ).at(0);
      const weight = feedback.signal === "bad" ? 50 : 40;
      const reasons = [...new Set([...(existing?.reasons ?? []), reason])];
      const priority =
        (existing?.priority ?? 0) +
        (existing?.reasons.includes(reason) ? 0 : weight);

      await tx
        .insert(datasetCandidates)
        .values({
          runId: feedback.runId,
          priority,
          reasons,
          status: "pending",
          createdAt: feedback.createdAt,
        })
        .onConflictDoUpdate({
          target: datasetCandidates.runId,
          set: { priority, reasons, status: "pending" },
        });
    });
  }
}

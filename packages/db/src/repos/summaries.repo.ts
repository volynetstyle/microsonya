import { and, desc, eq } from "drizzle-orm";
import type { SegmentSummary, SummaryRun } from "@microsonya/shared";
import type { MicrosonyaDb } from "../client.js";
import { segmentSummaries, summaryRuns } from "../schema.js";

export class SummariesRepo {
  constructor(private readonly db: MicrosonyaDb) {}

  findLastRun(chatId: string): SummaryRun | undefined {
    const row = this.db
      .select()
      .from(summaryRuns)
      .where(and(eq(summaryRuns.chatId, chatId), eq(summaryRuns.status, "ok")))
      .orderBy(desc(summaryRuns.createdAt))
      .limit(1)
      .all()[0];

    return row
      ? {
          id: row.id,
          chatId: row.chatId,
          commandMessageId: row.commandMessageId,
          createdAt: row.createdAt,
          fromMessageId: row.fromMessageId,
          toMessageId: row.toMessageId,
          mode: row.mode as SummaryRun["mode"],
          status: row.status as SummaryRun["status"],
          finalText: row.text
        }
      : undefined;
  }

  saveRun(run: SummaryRun): void {
    this.db
      .insert(summaryRuns)
      .values({
        id: run.id,
        chatId: run.chatId,
        commandMessageId: run.commandMessageId,
        createdAt: run.createdAt,
        fromMessageId: run.fromMessageId,
        toMessageId: run.toMessageId,
        mode: run.mode,
        status: run.status,
        text: run.finalText
      })
      .run();
  }

  findCachedSegment(chatId: string, fromMessageId: number, toMessageId: number, hash: string): SegmentSummary | undefined {
    const row = this.db
      .select()
      .from(segmentSummaries)
      .where(
        and(
          eq(segmentSummaries.chatId, chatId),
          eq(segmentSummaries.fromMessageId, fromMessageId),
          eq(segmentSummaries.toMessageId, toMessageId),
          eq(segmentSummaries.hash, hash)
        )
      )
      .limit(1)
      .all()[0];

    return row ? (JSON.parse(row.json) as SegmentSummary) : undefined;
  }

  saveSegment(summary: SegmentSummary): void {
    this.db
      .insert(segmentSummaries)
      .values({
        id: summary.segmentId,
        chatId: summary.chatId,
        fromMessageId: summary.fromMessageId,
        toMessageId: summary.toMessageId,
        hash: summary.hash,
        title: summary.title,
        json: JSON.stringify(summary),
        createdAt: Date.now()
      })
      .onConflictDoNothing()
      .run();
  }
}

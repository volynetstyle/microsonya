import { and, desc, eq } from "drizzle-orm";
import type { SegmentSummary, SummaryRun } from "@microsonya/shared";
import type { MicrosonyaDb } from "../client.js";
import { segmentSummaries, summaryRuns } from "../schema.js";

type SummaryRunRow = typeof summaryRuns.$inferSelect;

function mapSummaryRunRow(row: SummaryRunRow): SummaryRun {
  return {
    id: row.id,
    chatId: row.chatId,
    commandMessageId: row.commandMessageId,
    createdAt: row.createdAt,
    fromMessageId: row.fromMessageId,
    toMessageId: row.toMessageId,
    mode: row.mode as SummaryRun["mode"],
    status: row.status as SummaryRun["status"],
    finalText: row.text,
  };
}

export class SummariesRepo {
  constructor(private readonly db: MicrosonyaDb) {}

  async findLastRun(chatId: string): Promise<SummaryRun | undefined> {
    const row = (
      await this.db
      .select()
      .from(summaryRuns)
      .where(and(eq(summaryRuns.chatId, chatId), eq(summaryRuns.status, "ok")))
      .orderBy(desc(summaryRuns.createdAt))
      .limit(1)
    ).at(0);

    return row ? mapSummaryRunRow(row) : undefined;
  }

  async saveRun(run: SummaryRun): Promise<void> {
    await this.db
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
        text: run.finalText,
      })
      .onConflictDoUpdate({
        target: [summaryRuns.chatId, summaryRuns.commandMessageId],
        set: {
          createdAt: run.createdAt,
          fromMessageId: run.fromMessageId,
          toMessageId: run.toMessageId,
          mode: run.mode,
          status: run.status,
          text: run.finalText,
        },
      })
      .execute();
  }

  async findCachedSegment(
    chatId: string,
    fromMessageId: number,
    toMessageId: number,
    hash: string,
    schemaVersion = 1,
  ): Promise<SegmentSummary | undefined> {
    const row = (
      await this.db
      .select()
      .from(segmentSummaries)
      .where(
        and(
          eq(segmentSummaries.chatId, chatId),
          eq(segmentSummaries.fromMessageId, fromMessageId),
          eq(segmentSummaries.toMessageId, toMessageId),
          eq(segmentSummaries.hash, hash),
          eq(segmentSummaries.schemaVersion, schemaVersion),
        ),
      )
      .limit(1)
    ).at(0);

    return row ? (JSON.parse(row.json) as SegmentSummary) : undefined;
  }

  async saveSegment(summary: SegmentSummary, schemaVersion = 1): Promise<void> {
    const now = Date.now();

    await this.db
      .insert(segmentSummaries)
      .values({
        id: summary.segmentId,
        chatId: summary.chatId,
        fromMessageId: summary.fromMessageId,
        toMessageId: summary.toMessageId,
        hash: summary.hash,
        schemaVersion,
        title: summary.title,
        json: JSON.stringify(summary),
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          segmentSummaries.chatId,
          segmentSummaries.fromMessageId,
          segmentSummaries.toMessageId,
          segmentSummaries.hash,
          segmentSummaries.schemaVersion,
        ],
        set: {
          title: summary.title,
          json: JSON.stringify(summary),
          updatedAt: now,
        },
      })
      .execute();
  }
}

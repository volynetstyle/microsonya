import { and, desc, eq } from "drizzle-orm";
import type { SummaryRun } from "@microsonya/shared";
import type { MicrosonyaDb } from "../client.js";
import { summaryRuns } from "../schema.js";

export class SummariesRepo {
  constructor(private readonly db: MicrosonyaDb) {}

  async findLastRun(chatId: string): Promise<SummaryRun | undefined> {
    const row = (
      await this.db
        .select()
        .from(summaryRuns)
        .where(
          and(eq(summaryRuns.chatId, chatId), eq(summaryRuns.status, "ok")),
        )
        .orderBy(desc(summaryRuns.createdAt))
        .limit(1)
    ).at(0);
    return row
      ? {
          ...row,
          mode: row.mode as SummaryRun["mode"],
          status: row.status as SummaryRun["status"],
          finalText: row.text,
        }
      : undefined;
  }

  async saveRun(run: SummaryRun): Promise<void> {
    await this.db
      .insert(summaryRuns)
      .values({
        id: run.id,
        chatId: run.chatId,
        commandMessageId: run.commandMessageId,
        fromMessageId: run.fromMessageId,
        toMessageId: run.toMessageId,
        createdAt: run.createdAt,
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
}

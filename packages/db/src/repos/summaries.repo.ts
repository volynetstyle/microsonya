import { and, desc, eq, inArray } from "drizzle-orm";
import {
  SUMMARY_ACTIONS,
  asChatId,
  asMessageId,
  asSummaryId,
  asTimestampMs,
  type ChatId,
  type SummaryAction,
  type SummaryMode,
  type SummaryRun,
} from "@microsonya/shared";
import type { MicrosonyaDb } from "../client.js";
import { summaryRuns } from "../schema.js";

export class SummariesRepo {
  constructor(private readonly db: MicrosonyaDb) {}

  async findLastRun(chatId: ChatId): Promise<SummaryRun | undefined> {
    const row = (
      await this.db
        .select()
        .from(summaryRuns)
        .where(
          and(
            eq(summaryRuns.chatId, chatId),
            inArray(summaryRuns.status, ["summarized", "skipped"]),
          ),
        )
        .orderBy(desc(summaryRuns.createdAt))
        .limit(1)
    ).at(0);
    if (!row) return undefined;

    const covers = Object.freeze({
      firstId: asMessageId(row.fromMessageId),
      lastId: asMessageId(row.toMessageId),
      count: asMessageCount(row.messageCount),
    });

    return Object.freeze({
      id: asSummaryId(row.id),
      chatId: asChatId(row.chatId),
      commandMessageId: asMessageId(row.commandMessageId),
      createdAt: asTimestampMs(row.createdAt),
      covers,
      mode: asSummaryMode(row.mode),
      status: asSummaryStatus(row.status),
      action: asSummaryAction(row.action),
      finalText: row.text,
    });
  }

  async saveRun(run: SummaryRun): Promise<void> {
    await this.db
      .insert(summaryRuns)
      .values({
        id: run.id,
        chatId: run.chatId,
        commandMessageId: run.commandMessageId,
        fromMessageId: run.covers.firstId,
        toMessageId: run.covers.lastId,
        messageCount: run.covers.count,
        createdAt: run.createdAt,
        mode: run.mode,
        status: run.status,
        action: run.action,
        text: run.finalText,
      })
      .onConflictDoUpdate({
        target: [summaryRuns.chatId, summaryRuns.commandMessageId],
        set: {
          id: run.id,
          createdAt: run.createdAt,
          fromMessageId: run.covers.firstId,
          toMessageId: run.covers.lastId,
          messageCount: run.covers.count,
          mode: run.mode,
          status: run.status,
          action: run.action,
          text: run.finalText,
        },
      })
      .execute();
  }
}

function asMessageCount(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(
      "Summary message count must be a non-negative integer.",
    );
  }

  return value as number;
}

function asSummaryMode(value: string): SummaryMode {
  if (value === "recent" || value === "today" || value === "count") {
    return value;
  }

  throw new TypeError(`Unknown summary mode: ${value}`);
}

function asSummaryStatus(value: string): SummaryRun["status"] {
  if (value === "summarized" || value === "skipped") return value;
  throw new TypeError(`Unknown summary status: ${value}`);
}

function asSummaryAction(value: string): SummaryAction {
  if ((SUMMARY_ACTIONS as readonly string[]).includes(value)) {
    return value as SummaryAction;
  }

  throw new TypeError(`Unknown summary action: ${value}`);
}

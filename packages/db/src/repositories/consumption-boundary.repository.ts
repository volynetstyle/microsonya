import { and, desc, eq, inArray } from "drizzle-orm";
import { asMessageId, type AcceptedOutcomeRecord } from "@microsonya/shared";
import type { MicrosonyaDb } from "../client.js";
import { summaryRuns } from "../schema.js";

export interface ConsumptionBoundary {
  readonly covers: AcceptedOutcomeRecord["covers"];
}

export async function findLatestConsumptionBoundary(
  db: Pick<MicrosonyaDb, "select">,
  encryptedChatId: string,
): Promise<ConsumptionBoundary | undefined> {
  const row = (
    await db
      .select({
        fromMessageId: summaryRuns.fromMessageId,
        toMessageId: summaryRuns.toMessageId,
        messageCount: summaryRuns.messageCount,
      })
      .from(summaryRuns)
      .where(
        and(
          eq(summaryRuns.chatId, encryptedChatId),
          inArray(summaryRuns.mode, ["recent", "today"]),
          inArray(summaryRuns.status, ["summarized", "skipped"]),
        ),
      )
      .orderBy(
        desc(summaryRuns.commandMessageId),
        desc(summaryRuns.orchestrationAttempt),
        desc(summaryRuns.createdAt),
      )
      .limit(1)
  ).at(0);
  if (
    row?.fromMessageId === null ||
    row?.toMessageId === null ||
    row === undefined
  ) {
    return undefined;
  }
  return Object.freeze({
    covers: Object.freeze({
      firstId: asMessageId(row.fromMessageId),
      lastId: asMessageId(row.toMessageId),
      count: asMessageCount(row.messageCount),
    }),
  });
}

function asMessageCount(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(
      "Summary message count must be a non-negative integer.",
    );
  }
  return value as number;
}

import { sql } from "drizzle-orm";
import type { MicrosonyaDb } from "../client.js";
import { wmaChatCatalog } from "../schema.js";

export async function upsertWmaCatalogProjection(
  db: Pick<MicrosonyaDb, "insert">,
  input: {
    readonly chatId: string;
    readonly chatIdCiphertext: Buffer;
    readonly messageCount: number;
    readonly completedAt: number;
  },
): Promise<void> {
  await db
    .insert(wmaChatCatalog)
    .values({
      chatId: input.chatId,
      chatIdCiphertext: input.chatIdCiphertext,
      summaryCount: 1,
      messageCount: input.messageCount,
      lastSummaryAt: input.completedAt,
      updatedAt: input.completedAt,
    })
    .onConflictDoUpdate({
      target: wmaChatCatalog.chatId,
      set: {
        summaryCount: sql`${wmaChatCatalog.summaryCount} + 1`,
        messageCount: sql`${wmaChatCatalog.messageCount} + ${input.messageCount}`,
        lastSummaryAt: sql`greatest(${wmaChatCatalog.lastSummaryAt}, ${input.completedAt})`,
        updatedAt: input.completedAt,
      },
    });
}

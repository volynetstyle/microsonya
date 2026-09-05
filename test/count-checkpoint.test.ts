import { describe, expect, it } from "vitest";
import {
  SummariesRepo,
  createLedgerEncryption,
  summaryRuns,
} from "../packages/db/src/index.js";
import {
  asAuthorId,
  asChatId,
  asMessageId,
  asTimestampMs,
  type SummaryMode,
} from "../packages/shared/src/index.js";
import { createSummarizer } from "../packages/summarize/src/index.js";
import { openTestDb } from "./dbTestUtils.js";

describe("read-only count checkpoint isolation", () => {
  it.each([undefined, "recent", "today"] as const)(
    "keeps pending messages eligible after count (previous mode: %s)",
    async (previousMode) => {
      const client = await openTestDb();
      const repo = new SummariesRepo(
        client.db,
        createLedgerEncryption(Buffer.alloc(32, 9)),
      );
      const chatId = asChatId("count-checkpoint");
      const date = asTimestampMs(new Date(2026, 8, 5, 12).getTime());
      const messages = [1, 2, 3].map((id) => ({
        id: asMessageId(id),
        chatId,
        author: { id: asAuthorId("alice"), label: "Alice" },
        time: date,
        parentId: null,
        text: `Fact ${id}`,
      }));
      const seen: number[][] = [];
      const summarizer = createSummarizer({
        messages: { listByChat: async () => messages },
        summaries: {
          findLastRun: (id) => repo.findLastCheckpoint(id),
          saveRun: (run) => repo.saveRun(run),
          saveAttempt: (attempt) => repo.saveAttempt(attempt),
        },
        classifier: {
          classify: async (window) => {
            seen.push(window.messages.map(({ id }) => id));
            return {
              action: "SUMMARIZE",
              evidence: { source: "model", model: "test" },
            };
          },
        },
        conversationSummarizer: {
          summarize: async () => ({ text: "Stored summary" }),
        },
      });
      const command = (id: number, mode: SummaryMode) => ({
        chatId,
        commandMessageId: asMessageId(id),
        date,
        mode,
        ...(mode === "count" ? { count: 1 } : {}),
      });
      try {
        if (previousMode !== undefined)
          await summarizer.process(command(2, previousMode));
        await summarizer.process(command(4, "count"));
        seen.length = 0;
        await summarizer.process(command(5, "recent"));
        expect(seen).toEqual([previousMode === undefined ? [1, 2, 3] : [2, 3]]);
        const rows = await client.db.select().from(summaryRuns);
        const count = rows.find((row) => row.mode === "count")!;
        expect(count.checkpointBefore).toBe(
          previousMode === undefined ? null : 1,
        );
        expect(count.checkpointAfter).toBe(count.checkpointBefore);
        expect(count.toMessageId).toBe(3);
        expect(count.summaryTextCiphertext).not.toBeNull();
      } finally {
        await client.close();
      }
    },
  );
});

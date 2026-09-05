import { describe, expect, it } from "vitest";
import { createSummarizer } from "../packages/summarize/src/index.js";
import {
  asAuthorId,
  asChatId,
  asMessageId,
  asTimestampMs,
} from "../packages/shared/src/index.js";
import {
  SummaryAttemptsRepository,
  createLedgerEncryption,
  summaryRuns,
  wmaChatCatalog,
} from "../packages/db/src/index.js";
import { validateTelegramPayload } from "../apps/cloudflare/src/processor/presentation/validate-telegram-payload.js";
import { openTestDb } from "./dbTestUtils.js";

describe("semantic acceptance before ledger commit", () => {
  it.each([
    "",
    "  ",
    "<assistant>internal output</assistant>",
    "text\u0000text",
  ])("records only error evidence for rejected output %j", async (text) => {
    const client = await openTestDb();
    try {
      const repo = new SummaryAttemptsRepository(
        client.db,
        createLedgerEncryption(Buffer.alloc(32, 4)),
      );
      const chatId = asChatId("acceptance-chat");
      const workflow = createSummarizer({
        messages: {
          listByChat: async () => [
            {
              id: asMessageId(1),
              chatId,
              author: { id: asAuthorId("alice"), label: "Alice" },
              time: asTimestampMs(1000),
              parentId: null,
              text: "Deploy at 18:00",
            },
          ],
        },
        summaries: repo,
        classifier: {
          classify: async () => ({
            action: "SUMMARIZE",
            evidence: { source: "model", model: "test" },
          }),
        },
        conversationSummarizer: { summarize: async () => ({ text }) },
      });
      await expect(
        workflow.process({
          chatId,
          commandMessageId: asMessageId(2),
          date: asTimestampMs(2000),
          mode: "recent",
        }),
      ).rejects.toThrow();
      const rows = await client.db.select().from(summaryRuns);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        status: "error",
        checkpointAfter: null,
        summaryTextCiphertext: null,
      });
      expect(await repo.findLatestConsumptionBoundary(chatId)).toBeUndefined();
      expect(await client.db.select().from(wmaChatCatalog)).toEqual([]);
    } finally {
      await client.close();
    }
  });

  it("accepts a long semantic result independently of Telegram limits", async () => {
    const client = await openTestDb();
    try {
      const repo = new SummaryAttemptsRepository(
        client.db,
        createLedgerEncryption(Buffer.alloc(32, 4)),
      );
      const chatId = asChatId("long-acceptance-chat");
      const text = "Useful factual summary. ".repeat(300);
      const workflow = createSummarizer({
        messages: {
          listByChat: async () => [
            {
              id: asMessageId(1),
              chatId,
              author: { id: asAuthorId("alice"), label: "Alice" },
              time: asTimestampMs(1000),
              parentId: null,
              text: "Deploy at 18:00",
            },
          ],
        },
        summaries: repo,
        classifier: {
          classify: async () => ({
            action: "SUMMARIZE",
            evidence: { source: "model", model: "test" },
          }),
        },
        conversationSummarizer: { summarize: async () => ({ text }) },
      });
      await expect(
        workflow.process({
          chatId,
          commandMessageId: asMessageId(2),
          date: asTimestampMs(2000),
          mode: "recent",
        }),
      ).resolves.toMatchObject({ kind: "summarized" });
      expect(validateTelegramPayload(text)).toBe("SUMMARY_TOO_LONG");
      expect(
        (await repo.findLatestConsumptionBoundary(chatId))?.covers.lastId,
      ).toBe(1);
      expect(await client.db.select().from(wmaChatCatalog)).toHaveLength(1);
      expect((await repo.findLatestAcceptedOutcome(chatId))?.finalText).toBe(
        text,
      );
    } finally {
      await client.close();
    }
  });
});

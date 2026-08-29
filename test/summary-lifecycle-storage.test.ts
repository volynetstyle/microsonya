import { count, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  SummaryLifecycleRepo,
  createDataEncryption,
  summaryRunLifecycle,
} from "../packages/db/src/index.js";
import {
  asChatId,
  asMessageId,
  asTimestampMs,
} from "../packages/shared/src/index.js";
import { openTestDb } from "./dbTestUtils.js";

const command = Object.freeze({
  chatId: asChatId("-100123456"),
  commandMessageId: asMessageId(42),
  date: asTimestampMs(1_800_000_000_000),
  mode: "recent" as const,
});

describe("SummaryRun authoritative storage", () => {
  it("physically collapses concurrent duplicate ingress to one run", async () => {
    const client = await openTestDb();
    const repo = new SummaryLifecycleRepo(
      client.db,
      createDataEncryption(Buffer.alloc(32, 23)),
    );

    try {
      const runs = await Promise.all(
        Array.from({ length: 100 }, () =>
          repo.create(
            { idempotencyKey: "telegram:-100123456:42", command },
            asTimestampMs(1_800_000_000_100),
          ),
        ),
      );
      expect(new Set(runs.map(({ id }) => id)).size).toBe(1);

      const [{ value }] = await client.db
        .select({ value: count() })
        .from(summaryRunLifecycle);
      expect(value).toBe(1);

      const [stored] = await client.db.select().from(summaryRunLifecycle);
      expect(stored.chatId).not.toBe(command.chatId);
      expect(stored.idempotencyKey).not.toContain(command.chatId);
    } finally {
      await client.close();
    }
  });

  it("allows exactly one concurrent lease claim and persists delivery", async () => {
    const client = await openTestDb();
    const repo = new SummaryLifecycleRepo(
      client.db,
      createDataEncryption(Buffer.alloc(32, 24)),
    );

    try {
      const created = await repo.create(
        { idempotencyKey: "telegram:-100123456:42", command },
        asTimestampMs(1_800_000_000_100),
      );
      await repo.transition(
        created.id,
        "created",
        "queued",
        asTimestampMs(1_800_000_000_200),
      );

      const claims = await Promise.all(
        Array.from({ length: 50 }, () =>
          repo.claim(
            created.id,
            asTimestampMs(1_800_000_000_300),
            60_000,
            "processor-test",
          ),
        ),
      );
      expect(claims.filter((run) => run !== undefined)).toHaveLength(1);
      expect(claims.find((run) => run !== undefined)?.attempt).toBe(1);

      expect(
        await repo.saveSummary(
          created.id,
          "Durable result",
          asTimestampMs(1_800_000_000_400),
          { model: "test-model", promptVersion: "v1" },
        ),
      ).toBe(true);
      await repo.transition(
        created.id,
        "summary_ready",
        "delivering",
        asTimestampMs(1_800_000_000_500),
      );
      expect(
        await repo.markCompleted(
          created.id,
          777,
          asTimestampMs(1_800_000_000_600),
        ),
      ).toBe(true);

      const completed = await repo.get(created.id);
      expect(completed).toMatchObject({
        status: "completed",
        attempt: 1,
        summary: "Durable result",
        telegramMessageId: 777,
      });
    } finally {
      await client.close();
    }
  });

  it("rejects invalid lifecycle values at the database boundary", async () => {
    const client = await openTestDb();
    try {
      await expect(
        client.db.execute(
          sql`insert into ${summaryRunLifecycle} (
            id, idempotency_key, chat_id, chat_id_ciphertext,
            command_message_id, command_date, mode, status,
            created_at, updated_at, attempt
          ) values (
            'invalid', 'key', 'chat', ${Buffer.from("cipher")},
            1, 1, 'recent', 'teleported', 1, 1, 0
          )`,
        ),
      ).rejects.toThrow();

      const rows = await client.db
        .select()
        .from(summaryRunLifecycle)
        .where(eq(summaryRunLifecycle.id, "invalid"));
      expect(rows).toEqual([]);
    } finally {
      await client.close();
    }
  });
});

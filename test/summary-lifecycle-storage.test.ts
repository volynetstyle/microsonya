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
  messageThreadId: 77,
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
      expect(runs[0]?.command.messageThreadId).toBe(77);
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
          repo.claimProcessing(
            created.id,
            asTimestampMs(1_800_000_000_300),
            60_000,
            "processor-test",
          ),
        ),
      );
      expect(claims.filter((run) => run !== undefined)).toHaveLength(1);
      expect(claims.find((run) => run !== undefined)?.attempt).toBe(1);

      const claim = claims.find((run) => run !== undefined);
      expect(claim).toBeDefined();
      expect(
        await repo.storeDeliveryPayload(
          created.id,
          claim!.leaseToken,
          "Durable result",
          asTimestampMs(1_800_000_000_400),
          { model: "test-model", promptVersion: "v1" },
        ),
      ).toBe(true);
      const delivery = await repo.claimDelivery(
        created.id,
        asTimestampMs(1_800_000_000_500),
        60_000,
      );
      expect(delivery).toBeDefined();
      expect(
        await repo.markCompleted(
          created.id,
          delivery!.leaseToken,
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

  it("makes crashed processing and delivery leases recoverable", async () => {
    const client = await openTestDb();
    const repo = new SummaryLifecycleRepo(
      client.db,
      createDataEncryption(Buffer.alloc(32, 25)),
    );

    try {
      const created = await repo.create(
        { idempotencyKey: "telegram:-100123456:42", command },
        asTimestampMs(1_000),
      );
      await repo.transition(
        created.id,
        "created",
        "queued",
        asTimestampMs(2_000),
      );
      const firstClaim = await repo.claimProcessing(
        created.id,
        asTimestampMs(3_000),
        1_000,
        "processor-test",
      );
      expect(firstClaim).toBeDefined();

      expect(
        await repo.listStale(asTimestampMs(0), asTimestampMs(3_999)),
      ).toEqual([]);
      expect(
        (await repo.listStale(asTimestampMs(0), asTimestampMs(4_000))).map(
          ({ status }) => status,
        ),
      ).toEqual(["processing"]);

      await repo.expireLease(
        created.id,
        "processing",
        "LEASE_EXPIRED",
        asTimestampMs(4_000),
      );
      await repo.transition(
        created.id,
        "retry_wait",
        "queued",
        asTimestampMs(4_000),
      );
      const secondClaim = await repo.claimProcessing(
        created.id,
        asTimestampMs(4_001),
        1_000,
        "processor-test",
      );
      expect(secondClaim).toBeDefined();
      await repo.storeDeliveryPayload(
        created.id,
        secondClaim!.leaseToken,
        "Persisted",
        asTimestampMs(4_100),
        {},
      );
      await repo.claimDelivery(created.id, asTimestampMs(4_200), 1_000);

      expect(
        (await repo.listStale(asTimestampMs(0), asTimestampMs(5_200))).map(
          ({ status, summary }) => ({ status, summary }),
        ),
      ).toEqual([{ status: "delivering", summary: "Persisted" }]);

      expect(
        await repo.health(asTimestampMs(5_000), asTimestampMs(5_200)),
      ).toEqual({
        stuckRuns: 1,
        deliveryStuck: 1,
        retryOverdue: 0,
        permanentFailures: 0,
      });
    } finally {
      await client.close();
    }
  });

  it("fences an expired processing owner and renews only the current token", async () => {
    const client = await openTestDb();
    const repo = new SummaryLifecycleRepo(
      client.db,
      createDataEncryption(Buffer.alloc(32, 26)),
    );
    try {
      const created = await repo.create(
        { idempotencyKey: "telegram:-100123456:lease", command },
        asTimestampMs(1_000),
      );
      await repo.transition(
        created.id,
        "created",
        "queued",
        asTimestampMs(1_001),
      );
      const stale = await repo.claimProcessing(
        created.id,
        asTimestampMs(2_000),
        1_000,
        "processor-a",
      );
      expect(stale).toBeDefined();
      expect(
        await repo.renewLease(
          created.id,
          stale!.leaseToken,
          "processing",
          asTimestampMs(2_500),
          1_000,
        ),
      ).toBe(true);
      expect(
        await repo.expireLease(
          created.id,
          "processing",
          "LEASE_EXPIRED",
          asTimestampMs(3_500),
        ),
      ).toBe(true);
      await repo.transition(
        created.id,
        "retry_wait",
        "queued",
        asTimestampMs(3_500),
      );
      const current = await repo.claimProcessing(
        created.id,
        asTimestampMs(3_501),
        1_000,
        "processor-b",
      );
      expect(current).toBeDefined();
      expect(current!.leaseToken).not.toBe(stale!.leaseToken);
      expect(
        await repo.storeDeliveryPayload(
          created.id,
          stale!.leaseToken,
          "stale",
          asTimestampMs(3_600),
          {},
        ),
      ).toBe(false);
      expect(
        await repo.storeDeliveryPayload(
          created.id,
          current!.leaseToken,
          "current",
          asTimestampMs(3_600),
          {},
        ),
      ).toBe(true);
    } finally {
      await client.close();
    }
  });

  it("allows exactly one concurrent delivery claim", async () => {
    const client = await openTestDb();
    const repo = new SummaryLifecycleRepo(
      client.db,
      createDataEncryption(Buffer.alloc(32, 27)),
    );
    try {
      const created = await repo.create(
        { idempotencyKey: "telegram:-100123456:delivery", command },
        asTimestampMs(1_000),
      );
      await repo.transition(
        created.id,
        "created",
        "queued",
        asTimestampMs(1_001),
      );
      const processing = await repo.claimProcessing(
        created.id,
        asTimestampMs(1_002),
        10_000,
        "processor",
      );
      await repo.storeDeliveryPayload(
        created.id,
        processing!.leaseToken,
        "summary",
        asTimestampMs(1_003),
        {},
      );
      const deliveries = await Promise.all(
        Array.from({ length: 50 }, () =>
          repo.claimDelivery(created.id, asTimestampMs(1_004), 10_000),
        ),
      );
      expect(deliveries.filter(Boolean)).toHaveLength(1);
      expect(deliveries.find(Boolean)?.deliveryAttempt).toBe(1);
    } finally {
      await client.close();
    }
  });

  it("enforces one processing lease per chat for different commands", async () => {
    const client = await openTestDb();
    const repo = new SummaryLifecycleRepo(
      client.db,
      createDataEncryption(Buffer.alloc(32, 28)),
    );
    try {
      const first = await repo.create(
        { idempotencyKey: "telegram:-100123456:first", command },
        asTimestampMs(1_000),
      );
      const second = await repo.create(
        {
          idempotencyKey: "telegram:-100123456:second",
          command: { ...command, commandMessageId: asMessageId(43) },
        },
        asTimestampMs(1_000),
      );
      await Promise.all([
        repo.transition(first.id, "created", "queued", asTimestampMs(1_001)),
        repo.transition(second.id, "created", "queued", asTimestampMs(1_001)),
      ]);
      const claims = await Promise.allSettled([
        repo.claimProcessing(first.id, asTimestampMs(1_002), 10_000, "a"),
        repo.claimProcessing(second.id, asTimestampMs(1_002), 10_000, "b"),
      ]);
      const acquired = claims.filter(
        (result) => result.status === "fulfilled" && result.value !== undefined,
      );
      expect(acquired).toHaveLength(1);
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

      await expect(
        client.db.execute(
          sql`insert into ${summaryRunLifecycle} (
            id, idempotency_key, chat_id, chat_id_ciphertext,
            command_message_id, command_date, mode, requested_count, status,
            created_at, updated_at, attempt
          ) values (
            'invalid-count', 'invalid-count-key', 'chat', ${Buffer.from("cipher")},
            1, 1, 'count', null, 'created', 1, 1, 0
          )`,
        ),
      ).rejects.toThrow();

      const rows = await client.db
        .select()
        .from(summaryRunLifecycle)
        .where(eq(summaryRunLifecycle.id, "invalid-count"));
      expect(rows).toEqual([]);
    } finally {
      await client.close();
    }
  });
});

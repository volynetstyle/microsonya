import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  count,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  notExists,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  asChatId,
  asMessageId,
  asSummaryId,
  asTimestampMs,
  type SummaryCommand,
  type SummaryId,
  type TimestampMs,
} from "@microsonya/shared";
import type {
  LifecycleHealthSnapshot,
  OperationalSummaryRun,
  SummaryRunLifecycleStatus,
  SummaryRunRetryStage,
} from "@microsonya/run-lifecycle";
import { assertSummaryRunTransition } from "@microsonya/run-lifecycle";
import type { MicrosonyaDb } from "../client.js";
import type { DataEncryption } from "../encryption.js";
import { summaryRunLifecycle } from "../schema.js";
import { lockTelegramIngress } from "./messages.repo.js";

type LifecycleRow = typeof summaryRunLifecycle.$inferSelect;

export interface CreateLifecycleRunRequest {
  readonly idempotencyKey: string;
  readonly command: SummaryCommand;
}

export interface LifecycleRun extends OperationalSummaryRun {
  readonly command: SummaryCommand;
  readonly leaseExpiresAt?: TimestampMs;
  readonly summary?: string;
}

export interface LifecycleLease extends LifecycleRun {
  readonly leaseToken: string;
}

export class SummaryLifecycleRepo {
  constructor(
    private readonly db: MicrosonyaDb,
    private readonly encryption: DataEncryption,
  ) {}

  /** Atomic get-or-create; the HMAC idempotency key has a UNIQUE index. */
  async create(
    request: CreateLifecycleRunRequest,
    now: TimestampMs,
  ): Promise<LifecycleRun> {
    const idempotencyKey = this.encryption.lookup(
      request.idempotencyKey,
      "summary-run-idempotency-key",
    );
    const chatId = this.encryption.lookup(
      request.command.chatId,
      "telegram-chat-id",
    );
    await this.db.transaction(async (tx) => {
      await lockTelegramIngress(tx as MicrosonyaDb, chatId);
      await tx
        .insert(summaryRunLifecycle)
        .values({
          id: randomUUID(),
          idempotencyKey,
          chatId,
          chatIdCiphertext: this.encryption.encrypt(request.command.chatId),
          commandMessageId: request.command.commandMessageId,
          messageThreadId: request.command.messageThreadId,
          commandDate: request.command.date,
          mode: request.command.mode,
          requestedCount: request.command.count,
          status: "created",
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({ target: summaryRunLifecycle.idempotencyKey });
    });

    const row = await this.findRowByIdempotencyKey(idempotencyKey);
    if (row === undefined) {
      throw new Error("Idempotent SummaryRun creation did not produce a row.");
    }
    return this.map(row);
  }

  async get(id: SummaryId): Promise<LifecycleRun | undefined> {
    const row = (
      await this.db
        .select()
        .from(summaryRunLifecycle)
        .where(eq(summaryRunLifecycle.id, id))
        .limit(1)
    ).at(0);
    return row === undefined ? undefined : this.map(row);
  }

  async transition(
    id: SummaryId,
    from: SummaryRunLifecycleStatus,
    to: SummaryRunLifecycleStatus,
    now: TimestampMs,
  ): Promise<boolean> {
    assertSummaryRunTransition(from, to);
    const rows = await this.db
      .update(summaryRunLifecycle)
      .set({ status: to, updatedAt: now })
      .where(
        and(
          eq(summaryRunLifecycle.id, id),
          eq(summaryRunLifecycle.status, from),
        ),
      )
      .returning({ id: summaryRunLifecycle.id });
    return rows.length === 1;
  }

  /** Moves the stale threshold after a deliberate re-enqueue. */
  async touch(
    id: SummaryId,
    status: "queued" | "summary_ready",
    now: TimestampMs,
  ): Promise<boolean> {
    const rows = await this.db
      .update(summaryRunLifecycle)
      .set({ updatedAt: now })
      .where(
        and(
          eq(summaryRunLifecycle.id, id),
          eq(summaryRunLifecycle.status, status),
        ),
      )
      .returning({ id: summaryRunLifecycle.id });
    return rows.length === 1;
  }

  async claimProcessing(
    id: SummaryId,
    now: TimestampMs,
    leaseMs: number,
    processorVersion: string,
  ): Promise<LifecycleLease | undefined> {
    const leaseToken = randomUUID();
    const earlierRun = alias(summaryRunLifecycle, "earlier_summary_run");
    const rows = await this.db
      .update(summaryRunLifecycle)
      .set({
        status: "processing",
        updatedAt: now,
        leaseExpiresAt: asTimestampMs(now + leaseMs),
        leaseToken,
        nextRetryAt: null,
        retryStage: null,
        processorVersion,
        attempt: sql`${summaryRunLifecycle.attempt} + 1`,
      })
      .where(
        and(
          eq(summaryRunLifecycle.id, id),
          or(
            and(
              eq(summaryRunLifecycle.status, "queued"),
              or(
                isNull(summaryRunLifecycle.retryStage),
                eq(summaryRunLifecycle.retryStage, "processing"),
              ),
            ),
            and(
              eq(summaryRunLifecycle.status, "retry_wait"),
              eq(summaryRunLifecycle.retryStage, "processing"),
              or(
                isNull(summaryRunLifecycle.nextRetryAt),
                lte(summaryRunLifecycle.nextRetryAt, now),
              ),
            ),
            and(
              eq(summaryRunLifecycle.status, "processing"),
              lte(summaryRunLifecycle.leaseExpiresAt, now),
            ),
          ),
          notExists(
            this.db
              .select({ id: earlierRun.id })
              .from(earlierRun)
              .where(
                and(
                  eq(earlierRun.chatId, summaryRunLifecycle.chatId),
                  sql`${earlierRun.commandMessageId} <= ${summaryRunLifecycle.commandMessageId}`,
                  sql`${earlierRun.id} <> ${summaryRunLifecycle.id}`,
                  or(
                    inArray(earlierRun.status, ["created", "processing"]),
                    and(
                      eq(earlierRun.status, "queued"),
                      or(
                        isNull(earlierRun.retryStage),
                        eq(earlierRun.retryStage, "processing"),
                      ),
                    ),
                    and(
                      eq(earlierRun.status, "retry_wait"),
                      eq(earlierRun.retryStage, "processing"),
                    ),
                  ),
                ),
              ),
          ),
        ),
      )
      .returning();
    const row = rows.at(0);
    return row === undefined ? undefined : { ...this.map(row), leaseToken };
  }

  async saveSummary(
    id: SummaryId,
    leaseToken: string,
    summary: string,
    now: TimestampMs,
    metadata: { readonly model?: string; readonly promptVersion?: string },
  ): Promise<boolean> {
    const rows = await this.db
      .update(summaryRunLifecycle)
      .set({
        status: "summary_ready",
        summaryCiphertext: this.encryption.encrypt(summary),
        model: metadata.model,
        promptVersion: metadata.promptVersion,
        updatedAt: now,
        leaseExpiresAt: null,
        leaseToken: null,
      })
      .where(
        and(
          eq(summaryRunLifecycle.id, id),
          eq(summaryRunLifecycle.status, "processing"),
          eq(summaryRunLifecycle.leaseToken, leaseToken),
          gt(summaryRunLifecycle.leaseExpiresAt, now),
        ),
      )
      .returning({ id: summaryRunLifecycle.id });
    return rows.length === 1;
  }

  async claimDelivery(
    id: SummaryId,
    now: TimestampMs,
    leaseMs: number,
  ): Promise<LifecycleLease | undefined> {
    const leaseToken = randomUUID();
    const rows = await this.db
      .update(summaryRunLifecycle)
      .set({
        status: "delivering",
        updatedAt: now,
        leaseExpiresAt: asTimestampMs(now + leaseMs),
        leaseToken,
        nextRetryAt: null,
        retryStage: null,
        deliveryAttempt: sql`${summaryRunLifecycle.deliveryAttempt} + 1`,
      })
      .where(
        and(
          eq(summaryRunLifecycle.id, id),
          isNotNull(summaryRunLifecycle.summaryCiphertext),
          or(
            eq(summaryRunLifecycle.status, "summary_ready"),
            and(
              eq(summaryRunLifecycle.status, "queued"),
              eq(summaryRunLifecycle.retryStage, "delivery"),
            ),
            and(
              eq(summaryRunLifecycle.status, "retry_wait"),
              eq(summaryRunLifecycle.retryStage, "delivery"),
              or(
                isNull(summaryRunLifecycle.nextRetryAt),
                lte(summaryRunLifecycle.nextRetryAt, now),
              ),
            ),
            and(
              eq(summaryRunLifecycle.status, "delivering"),
              lte(summaryRunLifecycle.leaseExpiresAt, now),
            ),
          ),
        ),
      )
      .returning();
    const row = rows.at(0);
    return row === undefined ? undefined : { ...this.map(row), leaseToken };
  }

  async markCompleted(
    id: SummaryId,
    leaseToken: string,
    telegramMessageId: number,
    now: TimestampMs,
  ): Promise<boolean> {
    const rows = await this.db
      .update(summaryRunLifecycle)
      .set({
        status: "completed",
        telegramMessageId,
        deliveredAt: now,
        updatedAt: now,
        leaseExpiresAt: null,
        leaseToken: null,
      })
      .where(
        and(
          eq(summaryRunLifecycle.id, id),
          eq(summaryRunLifecycle.status, "delivering"),
          eq(summaryRunLifecycle.leaseToken, leaseToken),
          gt(summaryRunLifecycle.leaseExpiresAt, now),
        ),
      )
      .returning({ id: summaryRunLifecycle.id });
    return rows.length === 1;
  }

  async markRetry(
    id: SummaryId,
    leaseToken: string,
    from: "processing" | "delivering",
    errorCode: string,
    now: TimestampMs,
    nextRetryAt: TimestampMs,
  ): Promise<boolean> {
    const rows = await this.db
      .update(summaryRunLifecycle)
      .set({
        status: "retry_wait",
        retryStage: from === "processing" ? "processing" : "delivery",
        lastErrorCode: errorCode,
        lastErrorAt: now,
        nextRetryAt,
        updatedAt: now,
        leaseExpiresAt: null,
        leaseToken: null,
      })
      .where(
        and(
          eq(summaryRunLifecycle.id, id),
          eq(summaryRunLifecycle.status, from),
          eq(summaryRunLifecycle.leaseToken, leaseToken),
          gt(summaryRunLifecycle.leaseExpiresAt, now),
        ),
      )
      .returning({ id: summaryRunLifecycle.id });
    return rows.length === 1;
  }

  async markFailed(
    id: SummaryId,
    leaseToken: string,
    from: "processing" | "delivering",
    errorCode: string,
    now: TimestampMs,
  ): Promise<boolean> {
    const rows = await this.db
      .update(summaryRunLifecycle)
      .set({
        status: "failed_permanent",
        lastErrorCode: errorCode,
        lastErrorAt: now,
        updatedAt: now,
        leaseExpiresAt: null,
        leaseToken: null,
        nextRetryAt: null,
        retryStage: null,
      })
      .where(
        and(
          eq(summaryRunLifecycle.id, id),
          eq(summaryRunLifecycle.status, from),
          eq(summaryRunLifecycle.leaseToken, leaseToken),
          gt(summaryRunLifecycle.leaseExpiresAt, now),
        ),
      )
      .returning({ id: summaryRunLifecycle.id });
    return rows.length === 1;
  }

  async renewLease(
    id: SummaryId,
    leaseToken: string,
    stage: "processing" | "delivering",
    now: TimestampMs,
    leaseMs: number,
  ): Promise<boolean> {
    const rows = await this.db
      .update(summaryRunLifecycle)
      .set({
        updatedAt: now,
        leaseExpiresAt: asTimestampMs(now + leaseMs),
      })
      .where(
        and(
          eq(summaryRunLifecycle.id, id),
          eq(summaryRunLifecycle.status, stage),
          eq(summaryRunLifecycle.leaseToken, leaseToken),
          gt(summaryRunLifecycle.leaseExpiresAt, now),
        ),
      )
      .returning({ id: summaryRunLifecycle.id });
    return rows.length === 1;
  }

  async expireLease(
    id: SummaryId,
    from: "processing" | "delivering",
    errorCode: string,
    now: TimestampMs,
  ): Promise<boolean> {
    const rows = await this.db
      .update(summaryRunLifecycle)
      .set({
        status: "retry_wait",
        retryStage: from === "processing" ? "processing" : "delivery",
        lastErrorCode: errorCode,
        lastErrorAt: now,
        nextRetryAt: now,
        updatedAt: now,
        leaseExpiresAt: null,
        leaseToken: null,
      })
      .where(
        and(
          eq(summaryRunLifecycle.id, id),
          eq(summaryRunLifecycle.status, from),
          lte(summaryRunLifecycle.leaseExpiresAt, now),
        ),
      )
      .returning({ id: summaryRunLifecycle.id });
    return rows.length === 1;
  }

  async listStale(
    staleBefore: TimestampMs,
    dueAt: TimestampMs,
    limit = 100,
  ): Promise<LifecycleRun[]> {
    const rows = await this.db
      .select()
      .from(summaryRunLifecycle)
      .where(
        or(
          and(
            inArray(summaryRunLifecycle.status, [
              "created",
              "queued",
              "summary_ready",
            ]),
            lte(summaryRunLifecycle.updatedAt, staleBefore),
          ),
          and(
            inArray(summaryRunLifecycle.status, ["processing", "delivering"]),
            lte(summaryRunLifecycle.leaseExpiresAt, dueAt),
          ),
          and(
            eq(summaryRunLifecycle.status, "retry_wait"),
            lte(summaryRunLifecycle.nextRetryAt, dueAt),
          ),
        ),
      )
      .orderBy(asc(summaryRunLifecycle.updatedAt))
      .limit(limit);
    return rows.map((row) => this.map(row));
  }

  async health(
    staleBefore: TimestampMs,
    now: TimestampMs,
  ): Promise<LifecycleHealthSnapshot> {
    const [stuck, delivery, retry, failed] = await Promise.all([
      this.db
        .select({ value: count() })
        .from(summaryRunLifecycle)
        .where(
          and(
            notInArray(summaryRunLifecycle.status, [
              "completed",
              "failed_permanent",
            ]),
            lte(summaryRunLifecycle.updatedAt, staleBefore),
          ),
        ),
      this.db
        .select({ value: count() })
        .from(summaryRunLifecycle)
        .where(
          and(
            eq(summaryRunLifecycle.status, "delivering"),
            lte(summaryRunLifecycle.leaseExpiresAt, now),
          ),
        ),
      this.db
        .select({ value: count() })
        .from(summaryRunLifecycle)
        .where(
          and(
            eq(summaryRunLifecycle.status, "retry_wait"),
            lte(summaryRunLifecycle.nextRetryAt, now),
          ),
        ),
      this.db
        .select({ value: count() })
        .from(summaryRunLifecycle)
        .where(eq(summaryRunLifecycle.status, "failed_permanent")),
    ]);
    return {
      stuckRuns: stuck[0]?.value ?? 0,
      deliveryStuck: delivery[0]?.value ?? 0,
      retryOverdue: retry[0]?.value ?? 0,
      permanentFailures: failed[0]?.value ?? 0,
    };
  }

  private async findRowByIdempotencyKey(
    key: string,
  ): Promise<LifecycleRow | undefined> {
    return (
      await this.db
        .select()
        .from(summaryRunLifecycle)
        .where(eq(summaryRunLifecycle.idempotencyKey, key))
        .limit(1)
    ).at(0);
  }

  private map(row: LifecycleRow): LifecycleRun {
    const chatId = asChatId(this.encryption.decrypt(row.chatIdCiphertext));
    return Object.freeze({
      id: asSummaryId(row.id),
      idempotencyKey: row.idempotencyKey,
      status: asLifecycleStatus(row.status),
      createdAt: asTimestampMs(row.createdAt),
      updatedAt: asTimestampMs(row.updatedAt),
      attempt: row.attempt,
      deliveryAttempt: row.deliveryAttempt,
      command: Object.freeze({
        chatId,
        commandMessageId: asMessageId(row.commandMessageId),
        ...(row.messageThreadId === null
          ? {}
          : { messageThreadId: row.messageThreadId }),
        date: asTimestampMs(row.commandDate),
        mode: asMode(row.mode),
        ...(row.requestedCount === null ? {} : { count: row.requestedCount }),
      }),
      ...(row.leaseExpiresAt === null
        ? {}
        : { leaseExpiresAt: asTimestampMs(row.leaseExpiresAt) }),
      ...(row.nextRetryAt === null
        ? {}
        : { nextRetryAt: asTimestampMs(row.nextRetryAt) }),
      ...(row.retryStage === null
        ? {}
        : { retryStage: asRetryStage(row.retryStage) }),
      ...(row.lastErrorCode === null
        ? {}
        : { lastErrorCode: row.lastErrorCode }),
      ...(row.lastErrorAt === null
        ? {}
        : { lastErrorAt: asTimestampMs(row.lastErrorAt) }),
      ...(row.processorVersion === null
        ? {}
        : { processorVersion: row.processorVersion }),
      ...(row.model === null ? {} : { model: row.model }),
      ...(row.promptVersion === null
        ? {}
        : { promptVersion: row.promptVersion }),
      ...(row.summaryCiphertext === null
        ? {}
        : { summary: this.encryption.decrypt(row.summaryCiphertext) }),
      ...(row.deliveredAt === null
        ? {}
        : { deliveredAt: asTimestampMs(row.deliveredAt) }),
      ...(row.telegramMessageId === null
        ? {}
        : { telegramMessageId: row.telegramMessageId }),
    });
  }
}

function asLifecycleStatus(value: string): SummaryRunLifecycleStatus {
  if (
    [
      "created",
      "queued",
      "processing",
      "summary_ready",
      "delivering",
      "completed",
      "retry_wait",
      "failed_permanent",
    ].includes(value)
  ) {
    return value as SummaryRunLifecycleStatus;
  }
  throw new TypeError(`Unknown SummaryRun lifecycle status: ${value}`);
}

function asMode(value: string): SummaryCommand["mode"] {
  if (value === "recent" || value === "today" || value === "count")
    return value;
  throw new TypeError(`Unknown SummaryCommand mode: ${value}`);
}

function asRetryStage(value: string): SummaryRunRetryStage {
  if (value === "processing" || value === "delivery") return value;
  throw new TypeError(`Unknown SummaryRun retry stage: ${value}`);
}

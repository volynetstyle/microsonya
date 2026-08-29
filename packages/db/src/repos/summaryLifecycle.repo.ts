import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
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
  OperationalSummaryRun,
  SummaryRunLifecycleStatus,
} from "@microsonya/production-readiness";
import { assertSummaryRunTransition } from "@microsonya/production-readiness";
import type { MicrosonyaDb } from "../client.js";
import type { DataEncryption } from "../encryption.js";
import { summaryRunLifecycle } from "../schema.js";

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
    await this.db
      .insert(summaryRunLifecycle)
      .values({
        id: randomUUID(),
        idempotencyKey,
        chatId: this.encryption.lookup(
          request.command.chatId,
          "telegram-chat-id",
        ),
        chatIdCiphertext: this.encryption.encrypt(request.command.chatId),
        commandMessageId: request.command.commandMessageId,
        commandDate: request.command.date,
        mode: request.command.mode,
        requestedCount: request.command.count,
        status: "created",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: summaryRunLifecycle.idempotencyKey });

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

  async claim(
    id: SummaryId,
    now: TimestampMs,
    leaseMs: number,
    processorVersion: string,
  ): Promise<LifecycleRun | undefined> {
    const rows = await this.db
      .update(summaryRunLifecycle)
      .set({
        status: "processing",
        updatedAt: now,
        leaseExpiresAt: asTimestampMs(now + leaseMs),
        nextRetryAt: null,
        processorVersion,
        attempt: sql`${summaryRunLifecycle.attempt} + 1`,
      })
      .where(
        and(
          eq(summaryRunLifecycle.id, id),
          or(
            eq(summaryRunLifecycle.status, "queued"),
            and(
              eq(summaryRunLifecycle.status, "retry_wait"),
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
        ),
      )
      .returning();
    const row = rows.at(0);
    return row === undefined ? undefined : this.map(row);
  }

  async saveSummary(
    id: SummaryId,
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
      })
      .where(
        and(
          eq(summaryRunLifecycle.id, id),
          eq(summaryRunLifecycle.status, "processing"),
        ),
      )
      .returning({ id: summaryRunLifecycle.id });
    return rows.length === 1;
  }

  async markCompleted(
    id: SummaryId,
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
      })
      .where(
        and(
          eq(summaryRunLifecycle.id, id),
          eq(summaryRunLifecycle.status, "delivering"),
        ),
      )
      .returning({ id: summaryRunLifecycle.id });
    return rows.length === 1;
  }

  async markRetry(
    id: SummaryId,
    from: "processing" | "delivering",
    errorCode: string,
    now: TimestampMs,
    nextRetryAt: TimestampMs,
  ): Promise<boolean> {
    const rows = await this.db
      .update(summaryRunLifecycle)
      .set({
        status: "retry_wait",
        lastErrorCode: errorCode,
        lastErrorAt: now,
        nextRetryAt,
        updatedAt: now,
        leaseExpiresAt: null,
      })
      .where(
        and(
          eq(summaryRunLifecycle.id, id),
          eq(summaryRunLifecycle.status, from),
        ),
      )
      .returning({ id: summaryRunLifecycle.id });
    return rows.length === 1;
  }

  async markFailed(
    id: SummaryId,
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
      })
      .where(
        and(
          eq(summaryRunLifecycle.id, id),
          inArray(summaryRunLifecycle.status, [
            "created",
            "queued",
            "processing",
            "summary_ready",
            "delivering",
            "retry_wait",
          ]),
        ),
      )
      .returning({ id: summaryRunLifecycle.id });
    return rows.length === 1;
  }

  async listStale(
    staleBefore: TimestampMs,
    dueAt: TimestampMs,
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
      );
    return rows.map((row) => this.map(row));
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
      command: Object.freeze({
        chatId,
        commandMessageId: asMessageId(row.commandMessageId),
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

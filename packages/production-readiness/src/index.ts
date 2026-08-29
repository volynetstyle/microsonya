import type { SummaryId, TimestampMs } from "@microsonya/shared";

export const SUMMARY_RUN_LIFECYCLE_STATUSES = [
  "created",
  "queued",
  "processing",
  "summary_ready",
  "delivering",
  "completed",
  "retry_wait",
  "failed_permanent",
] as const;

export type SummaryRunLifecycleStatus =
  (typeof SUMMARY_RUN_LIFECYCLE_STATUSES)[number];

export interface OperationalSummaryRun {
  readonly id: SummaryId;
  readonly idempotencyKey: string;
  readonly status: SummaryRunLifecycleStatus;
  readonly createdAt: TimestampMs;
  readonly updatedAt: TimestampMs;
  readonly attempt: number;
  readonly lastErrorCode?: string;
  readonly lastErrorAt?: TimestampMs;
  readonly nextRetryAt?: TimestampMs;
  readonly processorVersion?: string;
  readonly model?: string;
  readonly promptVersion?: string;
  readonly deliveredAt?: TimestampMs;
  readonly telegramMessageId?: number;
}

const TRANSITIONS: Readonly<
  Record<SummaryRunLifecycleStatus, readonly SummaryRunLifecycleStatus[]>
> = Object.freeze({
  created: ["queued", "failed_permanent"],
  queued: ["processing", "retry_wait", "failed_permanent"],
  processing: ["summary_ready", "retry_wait", "failed_permanent"],
  summary_ready: ["delivering", "failed_permanent"],
  delivering: ["completed", "retry_wait", "failed_permanent"],
  retry_wait: ["queued", "processing", "delivering", "failed_permanent"],
  completed: [],
  failed_permanent: [],
});

export function canTransitionSummaryRun(
  from: SummaryRunLifecycleStatus,
  to: SummaryRunLifecycleStatus,
): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertSummaryRunTransition(
  from: SummaryRunLifecycleStatus,
  to: SummaryRunLifecycleStatus,
): void {
  if (!canTransitionSummaryRun(from, to)) {
    throw new TypeError(`Illegal SummaryRun transition: ${from} -> ${to}.`);
  }
}

export function isTerminalSummaryRunStatus(
  status: SummaryRunLifecycleStatus,
): boolean {
  return status === "completed" || status === "failed_permanent";
}

export type RunHealth =
  | { readonly kind: "terminal" }
  | { readonly kind: "active"; readonly ageMs: number }
  | { readonly kind: "stuck"; readonly ageMs: number };

export function assessRunHealth(
  run: Pick<OperationalSummaryRun, "status" | "updatedAt">,
  now: TimestampMs,
  recoveryThresholdMs: number,
): RunHealth {
  if (!Number.isFinite(recoveryThresholdMs) || recoveryThresholdMs <= 0) {
    throw new TypeError("recoveryThresholdMs must be positive.");
  }
  if (isTerminalSummaryRunStatus(run.status)) return { kind: "terminal" };

  const ageMs = Math.max(0, now - run.updatedAt);
  return ageMs >= recoveryThresholdMs
    ? { kind: "stuck", ageMs }
    : { kind: "active", ageMs };
}

export interface PipelineSnapshot {
  readonly created: number;
  readonly completed: number;
  readonly skipped: number;
  readonly pending: number;
  readonly failed: number;
  readonly stale: number;
  readonly dlq: number;
  readonly oldestQueueMessageAgeMs: number;
}

export interface ReadinessViolation {
  readonly code:
    | "RUN_ACCOUNTING_MISMATCH"
    | "STALE_RUNS"
    | "DLQ_NOT_EMPTY"
    | "QUEUE_AGE_EXCEEDED";
  readonly actual: number;
  readonly expected?: number;
}

export function evaluatePipelineSnapshot(
  snapshot: PipelineSnapshot,
  maximumQueueAgeMs: number,
): readonly ReadinessViolation[] {
  const violations: ReadinessViolation[] = [];
  const accounted =
    snapshot.completed + snapshot.skipped + snapshot.pending + snapshot.failed;
  if (snapshot.created !== accounted) {
    violations.push({
      code: "RUN_ACCOUNTING_MISMATCH",
      actual: accounted,
      expected: snapshot.created,
    });
  }
  if (snapshot.stale > 0) {
    violations.push({ code: "STALE_RUNS", actual: snapshot.stale });
  }
  if (snapshot.dlq > 0) {
    violations.push({ code: "DLQ_NOT_EMPTY", actual: snapshot.dlq });
  }
  if (snapshot.oldestQueueMessageAgeMs > maximumQueueAgeMs) {
    violations.push({
      code: "QUEUE_AGE_EXCEEDED",
      actual: snapshot.oldestQueueMessageAgeMs,
      expected: maximumQueueAgeMs,
    });
  }
  return violations;
}

export const PROCESSOR_CRASH_MATRIX = Object.freeze([
  { point: "before_claim", recovery: "process" },
  { point: "after_claim", recovery: "lease_expiry_then_resume" },
  { point: "after_classification", recovery: "safe_recompute" },
  { point: "after_model_response", recovery: "safe_recompute_or_reuse" },
  { point: "after_summary_persist", recovery: "reuse_persisted_summary" },
  { point: "before_telegram", recovery: "deliver" },
  {
    point: "after_telegram_before_delivery_persist",
    recovery: "ambiguous_external_side_effect",
  },
  { point: "after_delivery_persist", recovery: "no_op" },
] as const);

/** Telegram sendMessage has no application idempotency key. */
export const EXTERNAL_DELIVERY_GUARANTEE = "best-effort-exactly-once" as const;

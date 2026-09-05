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
export type SummaryExecutionStatus =
  (typeof SUMMARY_RUN_LIFECYCLE_STATUSES)[number];
export type SummaryRunRetryStage = "processing" | "delivery";
export interface SummaryExecution {
  readonly id: SummaryId;
  readonly idempotencyKey: string;
  readonly status: SummaryExecutionStatus;
  readonly createdAt: TimestampMs;
  readonly updatedAt: TimestampMs;
  readonly attempt: number;
  readonly deliveryAttempt: number;
  readonly retryStage?: SummaryRunRetryStage;
  readonly lastErrorCode?: string;
  readonly lastErrorAt?: TimestampMs;
  readonly nextRetryAt?: TimestampMs;
  readonly processorVersion?: string;
  readonly model?: string;
  readonly promptVersion?: string;
  readonly deliveredAt?: TimestampMs;
  readonly telegramMessageId?: number;
}
/** @deprecated Use SummaryExecutionStatus. */
export type SummaryRunLifecycleStatus = SummaryExecutionStatus;
/** @deprecated Use SummaryExecution. */
export type OperationalSummaryRun = SummaryExecution;
const TRANSITIONS: Readonly<
  Record<SummaryExecutionStatus, readonly SummaryExecutionStatus[]>
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
export function canTransitionSummaryExecution(
  from: SummaryExecutionStatus,
  to: SummaryExecutionStatus,
): boolean {
  return TRANSITIONS[from].includes(to);
}
export function assertSummaryExecutionTransition(
  from: SummaryExecutionStatus,
  to: SummaryExecutionStatus,
): void {
  if (!canTransitionSummaryExecution(from, to))
    throw new TypeError(
      `Illegal SummaryExecution transition: ${from} -> ${to}.`,
    );
}
export function isTerminalSummaryExecutionStatus(
  status: SummaryExecutionStatus,
): boolean {
  return status === "completed" || status === "failed_permanent";
}
/** @deprecated Use canTransitionSummaryExecution. */
export const canTransitionSummaryRun = canTransitionSummaryExecution;
/** @deprecated Use assertSummaryExecutionTransition. */
export const assertSummaryRunTransition = assertSummaryExecutionTransition;
/** @deprecated Use isTerminalSummaryExecutionStatus. */
export const isTerminalSummaryRunStatus = isTerminalSummaryExecutionStatus;
export type RunHealth =
  | { readonly kind: "terminal" }
  | { readonly kind: "active"; readonly ageMs: number }
  | { readonly kind: "stuck"; readonly ageMs: number };
export function assessRunHealth(
  run: Pick<SummaryExecution, "status" | "updatedAt">,
  now: TimestampMs,
  recoveryThresholdMs: number,
): RunHealth {
  if (!Number.isFinite(recoveryThresholdMs) || recoveryThresholdMs <= 0)
    throw new TypeError("recoveryThresholdMs must be positive.");
  if (isTerminalSummaryExecutionStatus(run.status)) return { kind: "terminal" };
  const ageMs = Math.max(0, now - run.updatedAt);
  return ageMs >= recoveryThresholdMs
    ? { kind: "stuck", ageMs }
    : { kind: "active", ageMs };
}
export interface LifecycleHealthSnapshot {
  readonly stuckRuns: number;
  readonly deliveryStuck: number;
  readonly retryOverdue: number;
  readonly permanentFailures: number;
}
export const EXTERNAL_DELIVERY_GUARANTEE = "best-effort-exactly-once" as const;
export type ReconciliationAction =
  | "none"
  | "enqueue-created"
  | "reenqueue"
  | "expire-lease-and-enqueue"
  | "enqueue-retry";
export function decideReconciliation(
  run: Pick<SummaryExecution, "status" | "updatedAt" | "nextRetryAt"> & {
    readonly leaseExpiresAt?: TimestampMs;
  },
  staleBefore: TimestampMs,
  now: TimestampMs,
): ReconciliationAction {
  switch (run.status) {
    case "created":
      return run.updatedAt <= staleBefore ? "enqueue-created" : "none";
    case "queued":
    case "summary_ready":
      return run.updatedAt <= staleBefore ? "reenqueue" : "none";
    case "processing":
    case "delivering":
      return run.leaseExpiresAt !== undefined && run.leaseExpiresAt <= now
        ? "expire-lease-and-enqueue"
        : "none";
    case "retry_wait":
      return run.nextRetryAt !== undefined && run.nextRetryAt <= now
        ? "enqueue-retry"
        : "none";
    case "completed":
    case "failed_permanent":
      return "none";
  }
}

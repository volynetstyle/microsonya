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
export type SummaryRunRetryStage = "processing" | "delivery";
export interface OperationalSummaryRun {
  readonly id: SummaryId;
  readonly idempotencyKey: string;
  readonly status: SummaryRunLifecycleStatus;
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
  if (!canTransitionSummaryRun(from, to))
    throw new TypeError(`Illegal SummaryRun transition: ${from} -> ${to}.`);
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
  if (!Number.isFinite(recoveryThresholdMs) || recoveryThresholdMs <= 0)
    throw new TypeError("recoveryThresholdMs must be positive.");
  if (isTerminalSummaryRunStatus(run.status)) return { kind: "terminal" };
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
  run: Pick<OperationalSummaryRun, "status" | "updatedAt" | "nextRetryAt"> & {
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

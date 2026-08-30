export {
  EXTERNAL_DELIVERY_GUARANTEE,
  type LifecycleHealthSnapshot,
} from "@microsonya/run-lifecycle";

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
  if (snapshot.created !== accounted)
    violations.push({
      code: "RUN_ACCOUNTING_MISMATCH",
      actual: accounted,
      expected: snapshot.created,
    });
  if (snapshot.stale > 0)
    violations.push({ code: "STALE_RUNS", actual: snapshot.stale });
  if (snapshot.dlq > 0)
    violations.push({ code: "DLQ_NOT_EMPTY", actual: snapshot.dlq });
  if (snapshot.oldestQueueMessageAgeMs > maximumQueueAgeMs)
    violations.push({
      code: "QUEUE_AGE_EXCEEDED",
      actual: snapshot.oldestQueueMessageAgeMs,
      expected: maximumQueueAgeMs,
    });
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

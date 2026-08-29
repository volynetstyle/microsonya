import { describe, expect, it } from "vitest";
import {
  asSummaryId,
  asTimestampMs,
} from "../packages/shared/src/index.js";
import {
  EXTERNAL_DELIVERY_GUARANTEE,
  PROCESSOR_CRASH_MATRIX,
  assessRunHealth,
  canTransitionSummaryRun,
  evaluatePipelineSnapshot,
} from "../packages/production-readiness/src/index.js";

describe("SummaryRun lifecycle proof", () => {
  it.each([
    ["created", "queued"],
    ["queued", "processing"],
    ["processing", "summary_ready"],
    ["summary_ready", "delivering"],
    ["delivering", "completed"],
    ["retry_wait", "processing"],
  ] as const)("allows %s -> %s", (from, to) => {
    expect(canTransitionSummaryRun(from, to)).toBe(true);
  });

  it.each([
    ["created", "completed"],
    ["processing", "completed"],
    ["completed", "processing"],
    ["failed_permanent", "queued"],
  ] as const)("rejects %s -> %s", (from, to) => {
    expect(canTransitionSummaryRun(from, to)).toBe(false);
  });

  it("classifies stale non-terminal work independently of HTTP health", () => {
    const run = {
      id: asSummaryId("run-1"),
      status: "processing" as const,
      updatedAt: asTimestampMs(1_000),
    };

    expect(assessRunHealth(run, asTimestampMs(10_000), 5_000)).toEqual({
      kind: "stuck",
      ageMs: 9_000,
    });
  });

  it("never classifies a terminal run as stuck", () => {
    expect(
      assessRunHealth(
        { status: "completed", updatedAt: asTimestampMs(1_000) },
        asTimestampMs(100_000),
        5_000,
      ),
    ).toEqual({ kind: "terminal" });
  });
});

describe("production health invariants", () => {
  it("accepts a fully accounted and recoverable snapshot", () => {
    expect(
      evaluatePipelineSnapshot(
        {
          created: 10,
          completed: 7,
          skipped: 1,
          pending: 2,
          failed: 0,
          stale: 0,
          dlq: 0,
          oldestQueueMessageAgeMs: 2_000,
        },
        60_000,
      ),
    ).toEqual([]);
  });

  it("reports every independent safety violation", () => {
    expect(
      evaluatePipelineSnapshot(
        {
          created: 10,
          completed: 4,
          skipped: 1,
          pending: 1,
          failed: 1,
          stale: 2,
          dlq: 3,
          oldestQueueMessageAgeMs: 90_000,
        },
        60_000,
      ).map(({ code }) => code),
    ).toEqual([
      "RUN_ACCOUNTING_MISMATCH",
      "STALE_RUNS",
      "DLQ_NOT_EMPTY",
      "QUEUE_AGE_EXCEEDED",
    ]);
  });
});

describe("crash recovery contract", () => {
  it("covers every processor side-effect boundary", () => {
    expect(PROCESSOR_CRASH_MATRIX.map(({ point }) => point)).toEqual([
      "before_claim",
      "after_claim",
      "after_classification",
      "after_model_response",
      "after_summary_persist",
      "before_telegram",
      "after_telegram_before_delivery_persist",
      "after_delivery_persist",
    ]);
  });

  it("records ambiguous Telegram delivery as a residual risk", () => {
    expect(EXTERNAL_DELIVERY_GUARANTEE).toBe("best-effort-exactly-once");
    expect(
      PROCESSOR_CRASH_MATRIX.find(
        ({ point }) => point === "after_telegram_before_delivery_persist",
      )?.recovery,
    ).toBe("ambiguous_external_side_effect");
  });
});

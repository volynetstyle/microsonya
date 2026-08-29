import { describe, expect, it } from "vitest";
import {
  decideReconciliation,
  type OperationalSummaryRun,
} from "../packages/run-lifecycle/src/index.js";
import { asSummaryId, asTimestampMs } from "../packages/shared/src/index.js";

const now = asTimestampMs(10_000);
const staleBefore = asTimestampMs(5_000);

function run(
  status: OperationalSummaryRun["status"],
  overrides: Partial<OperationalSummaryRun> & {
    leaseExpiresAt?: ReturnType<typeof asTimestampMs>;
  } = {},
) {
  return {
    id: asSummaryId("run-1"),
    idempotencyKey: "key",
    status,
    createdAt: asTimestampMs(1_000),
    updatedAt: asTimestampMs(1_000),
    attempt: 0,
    ...overrides,
  };
}

describe("reconciler policy matrix", () => {
  it.each([
    [run("created"), "enqueue-created"],
    [run("queued"), "reenqueue"],
    [run("summary_ready"), "reenqueue"],
    [
      run("processing", { leaseExpiresAt: asTimestampMs(9_999) }),
      "expire-lease-and-enqueue",
    ],
    [
      run("delivering", { leaseExpiresAt: asTimestampMs(9_999) }),
      "expire-lease-and-enqueue",
    ],
    [
      run("retry_wait", { nextRetryAt: asTimestampMs(10_000) }),
      "enqueue-retry",
    ],
    [run("completed"), "none"],
    [run("failed_permanent"), "none"],
  ] as const)("maps %s to %s", (candidate, expected) => {
    expect(decideReconciliation(candidate, staleBefore, now)).toBe(expected);
  });

  it.each([
    run("created", { updatedAt: asTimestampMs(5_001) }),
    run("queued", { updatedAt: asTimestampMs(5_001) }),
    run("processing", { leaseExpiresAt: asTimestampMs(10_001) }),
    run("delivering", { leaseExpiresAt: asTimestampMs(10_001) }),
    run("retry_wait", { nextRetryAt: asTimestampMs(10_001) }),
  ])("leaves fresh or not-yet-due state unchanged", (candidate) => {
    expect(decideReconciliation(candidate, staleBefore, now)).toBe("none");
  });

  it("becomes a no-op after the runtime heartbeats a re-enqueued run", () => {
    const first = run("queued");
    expect(decideReconciliation(first, staleBefore, now)).toBe("reenqueue");
    expect(
      decideReconciliation({ ...first, updatedAt: now }, staleBefore, now),
    ).toBe("none");
  });
});

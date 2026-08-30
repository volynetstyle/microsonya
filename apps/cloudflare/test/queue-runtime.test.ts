import {
  createExecutionContext,
  createMessageBatch,
  getQueueResult,
} from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import type { SummaryJob } from "@microsonya/contracts";
import { asSummaryId } from "@microsonya/shared";
import { handleSummaryQueue } from "../src/ingress/queue.js";
import {
  EMPTY_SUMMARY_MESSAGE,
  classifyUnknownFailure,
} from "../src/processor/policy.js";

type ProcessorResult = Awaited<ReturnType<Env["SUMMARY_PROCESSOR"]["process"]>>;

function message(id: string): ServiceBindingQueueMessage<SummaryJob> {
  return {
    id,
    timestamp: new Date("2026-08-29T00:00:00Z"),
    body: { runId: asSummaryId(`run-${id}`) },
    attempts: 1,
  };
}

function environment(
  process: (runId: string) => Promise<ProcessorResult>,
): Pick<Env, "SUMMARY_PROCESSOR" | "SUMMARY_JOBS" | "ANALYTICS"> {
  const send = vi.fn(async () => undefined);
  return {
    SUMMARY_PROCESSOR: { process } as Env["SUMMARY_PROCESSOR"],
    SUMMARY_JOBS: { send } as unknown as Queue<SummaryJob>,
    ANALYTICS: { writeDataPoint: vi.fn() } as unknown as AnalyticsEngineDataset,
  };
}

describe("summary Queue protocol in Workers runtime", () => {
  it("renders the empty result in valid Ukrainian and does not retry code bugs", () => {
    expect(EMPTY_SUMMARY_MESSAGE).toBe("Немає нових повідомлень для підсумку.");
    expect(classifyUnknownFailure(new TypeError("bug"))).toMatchObject({
      code: "TypeError",
      retryable: false,
    });
  });
  it("ACKs completed and permanent work and RETRYs transient work", async () => {
    const batch = createMessageBatch("summary-jobs", [
      message("completed"),
      message("permanent"),
      message("retry"),
    ]);
    const ctx = createExecutionContext();
    const env = environment(async (runId) => {
      if (runId.endsWith("completed")) return { disposition: "completed" };
      if (runId.endsWith("permanent")) {
        return { disposition: "permanent-failure" };
      }
      return { disposition: "retry", retryAfterSeconds: 30 };
    });

    await handleSummaryQueue(batch, env);
    const result = await getQueueResult(batch, ctx);

    expect(result.explicitAcks).toEqual(
      expect.arrayContaining(["completed", "permanent"]),
    );
    expect(result.explicitAcks).toContain("retry");
    expect(env.SUMMARY_JOBS.send).toHaveBeenCalledWith(
      { runId: "run-retry" },
      { delaySeconds: 30 },
    );
  });

  it("RETRYs an RPC exception without losing other batch outcomes", async () => {
    const batch = createMessageBatch("summary-jobs", [
      message("success"),
      message("throws"),
    ]);
    const ctx = createExecutionContext();
    const env = environment(async (runId) => {
      if (runId.endsWith("throws")) throw new Error("RPC unavailable");
      return { disposition: "completed" };
    });

    await handleSummaryQueue(batch, env);
    const result = await getQueueResult(batch, ctx);

    expect(result.explicitAcks).toContain("success");
    expect(result.retryMessages).toContainEqual({ msgId: "throws" });
  });
});

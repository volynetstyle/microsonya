import {
  createExecutionContext,
  createMessageBatch,
  getQueueResult,
} from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import type { SummaryJob } from "@microsonya/contracts";
import { asSummaryId } from "@microsonya/shared";
import { handleSummaryQueue } from "../src/ingress/queue.js";

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
): Pick<Env, "SUMMARY_PROCESSOR" | "ANALYTICS"> {
  return {
    SUMMARY_PROCESSOR: { process } as Env["SUMMARY_PROCESSOR"],
    ANALYTICS: { writeDataPoint: vi.fn() } as unknown as AnalyticsEngineDataset,
  };
}

describe("summary Queue protocol in Workers runtime", () => {
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
    expect(result.retryMessages).toContainEqual({ msgId: "retry" });
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

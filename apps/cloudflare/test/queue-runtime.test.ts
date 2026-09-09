import {
  createExecutionContext,
  createMessageBatch,
  getQueueResult,
} from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import type { SummaryJob } from "@microsonya/contracts";
import { asSummaryId } from "@microsonya/shared";
import { handleSummaryQueue } from "../src/ingress/summary-queue-consumer.js";
import {
  EMPTY_SUMMARY_MESSAGE,
  classifyUnknownFailure,
} from "../src/processor/policy.js";
import { isRetryableTelegramStatus } from "../src/ingress/policy.js";

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
  writeDataPoint: ReturnType<typeof vi.fn> = vi.fn(),
): Pick<Env, "SUMMARY_PROCESSOR" | "SUMMARY_JOBS" | "ANALYTICS"> {
  const send = vi.fn(async () => undefined);
  return {
    SUMMARY_PROCESSOR: { process } as Env["SUMMARY_PROCESSOR"],
    SUMMARY_JOBS: { send } as unknown as Queue<SummaryJob>,
    ANALYTICS: { writeDataPoint } as unknown as AnalyticsEngineDataset,
  };
}

describe("summary Queue protocol in Workers runtime", () => {
  it("does not let a permanent Telegram launcher error poison webhook retries", () => {
    expect(isRetryableTelegramStatus(400)).toBe(false);
    expect(isRetryableTelegramStatus(403)).toBe(false);
    expect(isRetryableTelegramStatus(429)).toBe(true);
    expect(isRetryableTelegramStatus(500)).toBe(true);
  });
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

  it("ACKs completed work even when Analytics Engine rejects a metric", async () => {
    const batch = createMessageBatch("summary-jobs", [message("completed")]);
    const ctx = createExecutionContext();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const env = environment(
      async () => ({ disposition: "completed" }),
      vi.fn(() => {
        throw new TypeError("writeDataPoint failed");
      }),
    );

    await expect(handleSummaryQueue(batch, env)).resolves.toBeUndefined();
    const result = await getQueueResult(batch, ctx);

    expect(result.explicitAcks).toContain("completed");
    expect(result.retryMessages).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

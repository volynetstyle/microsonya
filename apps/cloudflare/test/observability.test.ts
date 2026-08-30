import { describe, expect, it, vi } from "vitest";
import {
  errorName,
  logTelemetry,
  recordTelemetryMetric,
} from "../src/observability.js";
import { recordSummarizationEvent } from "../src/processor/telemetry.js";
import type { SummarizationTelemetryEvent } from "@microsonya/summarize";

describe("Worker observability contract", () => {
  it("emits queryable JSON without arbitrary error text", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    logTelemetry("info", "ingress", "summary.queue.disposition", {
      runId: "run-123",
      disposition: "completed",
    });

    expect(info).toHaveBeenCalledOnce();
    expect(JSON.parse(String(info.mock.calls[0]?.[0]))).toEqual({
      component: "ingress",
      event: "summary.queue.disposition",
      runId: "run-123",
      disposition: "completed",
    });
    info.mockRestore();
  });

  it("uses bounded Analytics Engine dimensions", () => {
    const writeDataPoint = vi.fn();
    recordTelemetryMetric(
      { writeDataPoint } as unknown as AnalyticsEngineDataset,
      "ingress",
      "summary.queue",
      "completed",
      42,
    );

    expect(writeDataPoint).toHaveBeenCalledWith({
      indexes: ["ingress:completed"],
      blobs: ["summary.queue", "completed"],
      doubles: [42],
    });
  });

  it("keeps telemetry failures from escaping into business logic", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const writeDataPoint = vi.fn(() => {
      throw new TypeError("Analytics Engine unavailable");
    });

    expect(() =>
      recordTelemetryMetric(
        { writeDataPoint } as unknown as AnalyticsEngineDataset,
        "ingress",
        "summary.queue",
        "completed",
      ),
    ).not.toThrow();
    expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toEqual({
      component: "ingress",
      event: "telemetry.metric_write_failed",
      errorName: "TypeError",
    });
    warn.mockRestore();
  });

  it("reduces failures to their safe error name", () => {
    expect(errorName(new Error("SQL params must never be logged"))).toBe(
      "Error",
    );
    expect(errorName("untrusted failure text")).toBe("UNKNOWN_ERROR");
  });

  it("projects model telemetry without conversation or model text", () => {
    const writeDataPoint = vi.fn();
    const secretPrompt = "PRIVATE CONVERSATION WINDOW";
    const secretResponse = "PRIVATE MODEL RESPONSE";
    const event = {
      traceId: "private-trace-id",
      chatId: "private-chat-id",
      commandMessageId: 42,
      offsetMs: 12,
      type: "model.response.envelope",
      stage: "summarizer",
      model: "model-name",
      attempt: 1,
      durationMs: 100,
      done: true,
      promptEvalCount: 200,
      evalCount: 20,
      contentChars: secretResponse.length,
      thinkingChars: 0,
      content: secretResponse,
      thinking: secretPrompt,
    } as SummarizationTelemetryEvent;

    recordSummarizationEvent(
      { writeDataPoint } as unknown as AnalyticsEngineDataset,
      event,
    );

    const serialized = JSON.stringify(writeDataPoint.mock.calls);
    expect(serialized).not.toContain(secretPrompt);
    expect(serialized).not.toContain(secretResponse);
    expect(serialized).not.toContain("private-chat-id");
    expect(serialized).not.toContain("private-trace-id");
    expect(writeDataPoint).toHaveBeenCalledWith({
      indexes: ["processor:summary"],
      blobs: ["model.response.envelope", "done", "summarizer", "", "", ""],
      doubles: [100, 0, 0, 200, 20, secretResponse.length, 0],
    });
  });
});

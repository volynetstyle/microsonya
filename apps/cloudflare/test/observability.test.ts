import { describe, expect, it, vi } from "vitest";
import {
  errorName,
  logTelemetry,
  recordTelemetryMetric,
} from "../src/observability.js";

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
      indexes: ["ingress", "completed"],
      blobs: ["summary.queue"],
      doubles: [42],
    });
  });

  it("reduces failures to their safe error name", () => {
    expect(errorName(new Error("SQL params must never be logged"))).toBe(
      "Error",
    );
    expect(errorName("untrusted failure text")).toBe("UNKNOWN_ERROR");
  });
});

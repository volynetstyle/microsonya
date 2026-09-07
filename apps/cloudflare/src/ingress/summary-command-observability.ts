import {
  errorName,
  logTelemetry,
  recordTelemetryMetric,
} from "../observability.js";

export interface SummaryCommandObservability {
  runAccepted(
    event: Readonly<{
      runId: string;
      disposition: "created" | "existing";
      durationMs: number;
    }>,
  ): void;

  markQueuedFailed(
    event: Readonly<{
      runId: string;
      error: unknown;
    }>,
  ): void;
}

export function createSummaryCommandObservability(
  analytics: AnalyticsEngineDataset,
): SummaryCommandObservability {
  return {
    runAccepted(event): void {
      logTelemetry("info", "ingress", "summary.run.accepted", {
        runId: event.runId,
        disposition: event.disposition,
        totalMs: event.durationMs,
      });
      recordTelemetryMetric(
        analytics,
        "ingress",
        "summary.run.accepted",
        event.disposition,
        event.durationMs,
      );
    },

    markQueuedFailed(event): void {
      logTelemetry("warn", "ingress", "summary.run.mark_queued_failed", {
        runId: event.runId,
        errorName: errorName(event.error),
      });
    },
  };
}

import type { ProcessSummaryRunResult } from "@microsonya/contracts";
import type { SummaryId } from "@microsonya/shared";
import {
  errorName,
  logTelemetry,
  recordTelemetryMetric,
} from "../observability.js";

type QueueSignal =
  | "completed"
  | "failed_permanent"
  | "rescheduled"
  | "error"
  | "malformed";

export interface SummaryQueueObservability {
  malformedJob(messageId: string): void;
  processorRpcFailed(runId: SummaryId, error: unknown): void;
  disposition(runId: SummaryId, result: ProcessSummaryRunResult): void;
  rescheduled(): void;
  rescheduleFailed(runId: SummaryId, error: unknown): void;
}

export function createSummaryQueueObservability(
  analytics: AnalyticsEngineDataset,
): SummaryQueueObservability {
  const metric = (event: string, signal: QueueSignal): void =>
    recordTelemetryMetric(analytics, "ingress", event, signal);

  return {
    malformedJob(messageId): void {
      logTelemetry("error", "ingress", "summary.queue.malformed_job", {
        messageId,
      });
      metric("summary.queue", "malformed");
    },

    processorRpcFailed(runId, error): void {
      logTelemetry("error", "ingress", "summary.queue.processor_rpc_error", {
        runId,
        errorName: errorName(error),
      });
      metric("summary.queue.processor_rpc", "error");
    },

    disposition(runId, result): void {
      logTelemetry("info", "ingress", "summary.queue.disposition", {
        runId,
        disposition: result.disposition,
        retryAfterSeconds:
          result.disposition === "retry" ? result.retryAfterSeconds : undefined,
      });
      if (result.disposition === "completed") {
        metric("summary.queue", "completed");
      } else if (result.disposition === "permanent-failure") {
        metric("summary.queue", "failed_permanent");
      }
    },

    rescheduled(): void {
      metric("summary.queue", "rescheduled");
    },

    rescheduleFailed(runId, error): void {
      logTelemetry("error", "ingress", "summary.queue.reschedule_error", {
        runId,
        errorName: errorName(error),
      });
      metric("summary.queue.reschedule", "error");
    },
  };
}

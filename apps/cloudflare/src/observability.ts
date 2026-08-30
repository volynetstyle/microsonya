export type TelemetryComponent = "ingress" | "lifecycle" | "processor" | "wma";

export type TelemetryOutcome =
  | "created"
  | "completed"
  | "failed_permanent"
  | "malformed"
  | "rescheduled"
  | "error"
  | "retry";

type LogFields = Readonly<{
  runId?: string;
  messageId?: string | number;
  disposition?: string;
  retryAfterSeconds?: number;
  errorName?: string;
  staleCount?: number;
  totalMs?: number;
  dbMs?: number;
  telegramMs?: number;
  rows?: number;
  responseBytes?: number;
  cacheHit?: boolean;
  messageCount?: number;
  contextMessageCount?: number;
  modelCalls?: number;
  checkpointAdvanced?: boolean;
  action?: string;
  stage?: string;
  errorCode?: string;
}>;

/**
 * Emits the only application-log shape used by the Workers pipeline.
 *
 * Do not add request bodies, Telegram chat IDs, summary text, SQL strings, or
 * error messages here: all of those may contain user data or bound parameters.
 */
export function logTelemetry(
  level: "info" | "warn" | "error",
  component: TelemetryComponent,
  event: string,
  fields: LogFields = {},
): void {
  const entry = JSON.stringify({
    component,
    event,
    ...fields,
  });
  if (level === "error") console.error(entry);
  else if (level === "warn") console.warn(entry);
  else console.info(entry);
}

/** Analytics Engine dimensions are intentionally low-cardinality. */
export function recordTelemetryMetric(
  analytics: AnalyticsEngineDataset,
  component: TelemetryComponent,
  event: string,
  outcome: TelemetryOutcome,
  durationMs?: number,
): void {
  recordAnalyticsPoint(analytics, {
    component,
    index: `${component}:${outcome}`,
    blobs: [event, outcome],
    doubles: durationMs === undefined ? [] : [durationMs],
  });
}

export function recordAnalyticsPoint(
  analytics: AnalyticsEngineDataset,
  point: Readonly<{
    component: TelemetryComponent;
    index: string;
    blobs: readonly string[];
    doubles?: readonly number[];
  }>,
): void {
  try {
    analytics.writeDataPoint({
      indexes: [point.index],
      blobs: [...point.blobs],
      doubles: [...(point.doubles ?? [])],
    });
  } catch (error) {
    // Analytics Engine writes are non-blocking and auxiliary. A rejected
    // point must never alter request, Queue, model, persistence, or delivery
    // control flow.
    logTelemetry("warn", point.component, "telemetry.metric_write_failed", {
      errorName: errorName(error),
    });
  }
}

export function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "UNKNOWN_ERROR";
}

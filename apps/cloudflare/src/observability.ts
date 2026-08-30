export type TelemetryComponent = "ingress" | "lifecycle" | "processor" | "wma";

export type TelemetryOutcome =
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
  analytics.writeDataPoint({
    indexes: [component, outcome],
    blobs: [event],
    doubles: durationMs === undefined ? [] : [durationMs],
  });
}

export function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "UNKNOWN_ERROR";
}

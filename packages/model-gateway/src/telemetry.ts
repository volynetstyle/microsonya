import type { ModelCallContext, ModelCallTelemetry, ModelUsage } from "./ModelClient.js";

export function emitModelTelemetry(
  onTelemetry: ((event: ModelCallTelemetry) => void) | undefined,
  model: string,
  context: ModelCallContext,
  startedAt: number,
  status: ModelCallTelemetry["status"],
  usage?: ModelUsage,
  error?: unknown,
): void {
  onTelemetry?.({
    ...context,
    model,
    durationMs: performance.now() - startedAt,
    status,
    usage,
    ...(error instanceof Error ? { error: error.message } : {}),
  });
}

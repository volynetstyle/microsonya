import type { Model } from "./Model.js";

export type ModelTelemetry = {
  durationMs: number;
  status: "ok" | "error";
  error?: string;
};

export function withTelemetry(
  model: Model,
  onCall: (event: ModelTelemetry) => void,
): Model {
  return {
    async generate(prompt, schema, options) {
      const startedAt = performance.now();
      try {
        const value = await model.generate(prompt, schema, options);
        onCall({ durationMs: performance.now() - startedAt, status: "ok" });
        return value;
      } catch (error) {
        onCall({
          durationMs: performance.now() - startedAt,
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
  };
}

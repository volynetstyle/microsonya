import { z } from "zod";
import type {
  ModelOutputFailure,
  ModelStage,
  SummarizationTelemetryTrace,
} from "./telemetry.js";

export class ModelOutputError extends Error {
  readonly code: ModelOutputFailure;
  readonly stage: `${ModelStage}.output`;
  readonly outputChars: number;
  readonly outputPreview: string;
  readonly raw: string;

  constructor(options: {
    readonly code: ModelOutputFailure;
    readonly stage: ModelStage;
    readonly raw: string;
    readonly cause?: unknown;
  }) {
    super(messageFor(options.code, options.stage), { cause: options.cause });
    this.name = "ModelOutputError";
    this.code = options.code;
    this.stage = `${options.stage}.output`;
    this.outputChars = options.raw.length;
    this.outputPreview = options.raw.slice(0, 500);
    this.raw = options.raw;
  }
}

export function parseModelOutput<T>(options: {
  readonly raw: string;
  readonly schema: z.ZodType<T>;
  readonly stage: ModelStage;
  readonly model: string;
  readonly durationMs: number;
  readonly attempt?: number;
  readonly telemetry?: SummarizationTelemetryTrace;
}): T {
  const { raw, schema, stage, model, durationMs, attempt, telemetry } = options;
  telemetry?.record({
    type: "model.response.raw",
    stage,
    model,
    attempt,
    durationMs,
    responseChars: raw.length,
    response: raw,
  });

  if (raw.trim().length === 0) {
    throw invalidOutput("MODEL_OUTPUT_EMPTY");
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (cause) {
    throw invalidOutput("MODEL_OUTPUT_INVALID_JSON", cause);
  }

  const result = schema.safeParse(value);
  if (!result.success) {
    throw invalidOutput("MODEL_OUTPUT_SCHEMA_MISMATCH", result.error);
  }
  return result.data;

  function invalidOutput(
    reason: ModelOutputFailure,
    cause?: unknown,
  ): ModelOutputError {
    telemetry?.record({
      type: "model.response.invalid",
      stage,
      model,
      attempt,
      durationMs,
      responseChars: raw.length,
      reason,
    });
    return new ModelOutputError({ code: reason, stage, raw, cause });
  }
}

function messageFor(code: ModelOutputFailure, stage: ModelStage): string {
  switch (code) {
    case "MODEL_OUTPUT_EMPTY":
      return `${stage} model returned empty output.`;
    case "MODEL_OUTPUT_INVALID_JSON":
      return `${stage} model returned invalid JSON.`;
    case "MODEL_OUTPUT_SCHEMA_MISMATCH":
      return `${stage} model output did not match the required schema.`;
  }
}

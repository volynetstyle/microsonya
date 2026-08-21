import {
  generateText,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
  type LanguageModel,
} from "ai";
import type { z } from "zod";
import {
  InvalidModelOutputError,
  type ModelCallContext,
  type ModelCallTelemetry,
  type ModelUsage,
} from "./ModelClient.js";
import type { StructuredGenerator, TextGenerator } from "./ModelGenerators.js";
import { normalizeAiSdkUsage } from "./modelUsage.js";
import { emitModelTelemetry } from "./telemetry.js";

export type AiSdkGeneratorOptions = {
  model: LanguageModel;
  /** Model id used for telemetry only; the model itself already carries it internally. */
  modelId: string;
  timeoutMs?: number;
  maxRetries?: number;
  temperature?: number;
  maxTokens?: number;
  onTelemetry?: (event: ModelCallTelemetry) => void;
};

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_TEMPERATURE = 0.1;
const DEFAULT_MAX_TOKENS = 2_500;
const DEFAULT_MAX_RETRIES = 2;

/** Generates text and schema-constrained objects through one AI SDK language model. */
export class AiSdkGenerator implements TextGenerator, StructuredGenerator {
  constructor(private readonly options: AiSdkGeneratorOptions) {}

  async generateText(
    prompt: string,
    context: ModelCallContext = { operation: "summary-merge" },
    signal?: AbortSignal,
  ): Promise<string> {
    const startedAt = performance.now();
    try {
      const result = await generateText({
        model: this.options.model,
        prompt,
        abortSignal: signal,
        ...this.callSettings(context),
      });
      this.emitTelemetry(
        context,
        startedAt,
        "ok",
        normalizeAiSdkUsage(result.usage),
      );
      return result.text;
    } catch (error) {
      this.emitTelemetry(context, startedAt, "error", undefined, error);
      throw error;
    }
  }

  async generateObject<T>(
    prompt: string,
    schema: z.ZodType<T>,
    context: ModelCallContext = { operation: "segment-summary" },
    signal?: AbortSignal,
  ): Promise<T> {
    const startedAt = performance.now();
    try {
      const result = await generateText({
        model: this.options.model,
        prompt,
        abortSignal: signal,
        output: Output.object({ schema }),
        ...this.callSettings(context),
      });

      this.emitTelemetry(
        context,
        startedAt,
        "ok",
        normalizeAiSdkUsage(result.usage),
      );
      return result.output;
    } catch (error) {
      this.emitTelemetry(context, startedAt, "error", undefined, error);
      if (
        NoOutputGeneratedError.isInstance(error) ||
        NoObjectGeneratedError.isInstance(error)
      ) {
        throw new InvalidModelOutputError({
          cause: error,
          rawText:
            NoObjectGeneratedError.isInstance(error) &&
            typeof error.text === "string"
              ? error.text
              : undefined,
        });
      }

      throw error;
    }
  }

  private emitTelemetry(
    context: ModelCallContext,
    startedAt: number,
    status: ModelCallTelemetry["status"],
    usage?: ModelUsage,
    error?: unknown,
  ): void {
    emitModelTelemetry(
      this.options.onTelemetry,
      this.options.modelId,
      context,
      startedAt,
      status,
      usage,
      error,
    );
  }

  private callSettings(context: ModelCallContext) {
    return {
      timeout: this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxRetries: this.options.maxRetries ?? DEFAULT_MAX_RETRIES,
      temperature: this.options.temperature ?? DEFAULT_TEMPERATURE,
      maxOutputTokens:
        context.maxOutputTokens ?? this.options.maxTokens ?? DEFAULT_MAX_TOKENS,
    };
  }
}

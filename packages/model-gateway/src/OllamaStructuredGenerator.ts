import type { z } from "zod";
import {
  InvalidModelOutputError,
  type ModelCallContext,
  type ModelCallTelemetry,
  type ModelUsage,
} from "./ModelClient.js";
import type { StructuredGenerator } from "./ModelGenerators.js";
import { normalizeOllamaUsage } from "./modelUsage.js";
import { emitModelTelemetry } from "./telemetry.js";

/** Raised when the Ollama HTTP request itself fails (bad status, network error) — as opposed to the response body failing schema validation. */
export class OllamaRequestError extends Error {}

export type OllamaStructuredGeneratorOptions = {
  baseUrl: string;
  model: string;
  timeoutMs?: number;
  temperature?: number;
  maxTokens?: number;
  fetch?: typeof globalThis.fetch;
  onTelemetry?: (event: ModelCallTelemetry) => void;
};

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_TEMPERATURE = 1;
const DEFAULT_MAX_TOKENS = 2048;

/**
 * Structured generation through Ollama's own `/api/chat` JSON mode instead
 * of the generic OpenAI-compatible schema translation, which Ollama does not
 * implement reliably (property ordering, format fidelity).
 */
export class OllamaStructuredGenerator implements StructuredGenerator {
  private readonly baseUrl: string;

  constructor(private readonly options: OllamaStructuredGeneratorOptions) {
    this.baseUrl = stripToOrigin(options.baseUrl);
  }

  async generateObject<T>(
    prompt: string,
    schema: z.ZodType<T>,
    context: ModelCallContext = { operation: "segment-summary" },
    signal?: AbortSignal,
  ): Promise<T> {
    const { model } = this.options;
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const temperature = this.options.temperature ?? DEFAULT_TEMPERATURE;
    const maxTokens = this.options.maxTokens ?? DEFAULT_MAX_TOKENS;
    const startedAt = performance.now();
    let body = "";
    let usage: ModelUsage | undefined;
    let rawText: string | undefined;
    let responseReceived = false;

    try {
      const response = await (this.options.fetch ?? globalThis.fetch)(
        `${this.baseUrl}/api/chat`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model,
            stream: false,
            think: "low",
            format: "json",
            messages: [{ role: "user", content: prompt }],
            options: {
              temperature,
              num_predict: context.maxOutputTokens ?? maxTokens,
            },
          }),
          signal: combineAbortSignals(signal, AbortSignal.timeout(timeoutMs)),
        },
      );
      body = await response.text();
      responseReceived = true;
      if (!response.ok) {
        throw new OllamaRequestError(
          `Ollama JSON request failed (${response.status}): ${body}`,
        );
      }

      const envelope = JSON.parse(body) as Record<string, unknown> & {
        message?: { content?: unknown; thinking?: unknown };
      };
      rawText =
        typeof envelope.message?.content === "string"
          ? envelope.message.content
          : undefined;
      if (!rawText) throw new Error("Ollama response has no message content");
      usage = normalizeOllamaUsage(envelope, rawText);
      const parsed = schema.parse(JSON.parse(rawText));
      this.emitTelemetry(context, startedAt, "ok", usage);
      return parsed;
    } catch (error) {
      this.emitTelemetry(context, startedAt, "error", usage, error);
      if (!responseReceived) throw error;
      if (error instanceof OllamaRequestError) {
        throw error;
      }
      throw new InvalidModelOutputError({
        cause: error,
        rawText: rawText || body,
      });
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
      this.options.model,
      context,
      startedAt,
      status,
      usage,
      error,
    );
  }
}

function stripToOrigin(baseUrl: string): string {
  return new URL(baseUrl).origin;
}

function combineAbortSignals(
  external: AbortSignal | undefined,
  timeout: AbortSignal,
): AbortSignal {
  return external ? AbortSignal.any([external, timeout]) : timeout;
}

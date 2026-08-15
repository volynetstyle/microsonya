import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import {
  generateText,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
  type LanguageModel,
} from "ai";
import { countTokens } from "gpt-tokenizer/encoding/o200k_harmony";
import type { z } from "zod";
import {
  InvalidModelOutputError,
  type ModelCallContext,
  type ModelCallTelemetry,
  type ModelCallUsage,
  type ModelClient,
} from "./ModelClient.js";

export type AiSdkModelClientOptions = {
  baseUrl: string;
  apiKey?: string;
  models: string[];
  mergeModel?: string;
  timeoutMs?: number;
  maxRetries?: number;
  temperature?: number;
  maxTokens?: number;
  appName?: string;
  referer?: string;
  fetch?: typeof globalThis.fetch;
  onTelemetry?: (event: ModelCallTelemetry) => void;
};

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_TEMPERATURE = 1;
const DEFAULT_MAX_TOKENS = 2048;

export class AiSdkModelClient implements ModelClient {
  private readonly textModel: LanguageModel;
  private readonly structuredModel: LanguageModel;
  private readonly defaultMaxRetries: number;
  private readonly nativeOllamaBaseUrl?: string;
  private readonly nativeOllamaModel?: string;
  private readonly primaryModel: string;
  private readonly mergeModel: string;

  constructor(private readonly options: AiSdkModelClientOptions) {
    const [primaryModel, ...fallbackModels] = options.models;

    if (!primaryModel) {
      throw new Error("At least one model must be configured.");
    }
    this.primaryModel = primaryModel;
    this.mergeModel = options.mergeModel ?? primaryModel;

    if (isNativeOllamaUrl(options.baseUrl)) {
      this.nativeOllamaBaseUrl = normalizeNativeOllamaBaseUrl(options.baseUrl);
      this.nativeOllamaModel = primaryModel;
    }

    if (isOpenRouterUrl(options.baseUrl)) {
      const openrouter = createOpenRouter({
        baseURL: normalizeBaseUrl(options.baseUrl),
        apiKey: options.apiKey,
        appName: options.appName,
        appUrl: options.referer,
        compatibility: "strict",
        fetch: options.fetch,
      });

      const sharedSettings = {
        models: fallbackModels.length > 0 ? fallbackModels : undefined,
      };

      this.defaultMaxRetries = 0;
      this.textModel = openrouter(options.mergeModel ?? "openrouter/free");
      this.structuredModel = openrouter(primaryModel, {
        ...sharedSettings,
        plugins: [{ id: "response-healing" }],
        provider: {
          require_parameters: true,
        },
      });
      return;
    }

    const provider = createOpenAICompatible({
      name: "openaiCompatible",
      baseURL: normalizeBaseUrl(options.baseUrl),
      apiKey: options.apiKey,
      headers: {
        ...(options.referer ? { "HTTP-Referer": options.referer } : {}),
        ...(options.appName ? { "X-Title": options.appName } : {}),
      },
      fetch: options.fetch,
      supportsStructuredOutputs: true,
    });

    this.defaultMaxRetries = 2;
    this.textModel = provider.chatModel(options.mergeModel ?? primaryModel);
    this.structuredModel = this.textModel;
  }

  async generateText(
    prompt: string,
    context: ModelCallContext = { operation: "summary-merge" },
    signal?: AbortSignal,
  ): Promise<string> {
    const startedAt = performance.now();
    try {
      const result = await generateText({
        model: this.textModel,
        prompt,
        abortSignal: signal,
        ...this.callSettings(context),
      });
      this.emitTelemetry(
        this.mergeModel,
        context,
        startedAt,
        "ok",
        readAiSdkUsage(result.usage),
      );
      return result.text;
    } catch (error) {
      this.emitTelemetry(
        this.mergeModel,
        context,
        startedAt,
        "error",
        undefined,
        error,
      );
      throw error;
    }
  }

  async generateObject<T>(
    prompt: string,
    schema: z.ZodType<T>,
    context: ModelCallContext = { operation: "segment-summary" },
    signal?: AbortSignal,
  ): Promise<T> {
    if (this.nativeOllamaBaseUrl && this.nativeOllamaModel) {
      return this.generateNativeOllamaJson(prompt, schema, context, signal);
    }

    const startedAt = performance.now();
    try {
      const result = await generateText({
        model: this.structuredModel,
        prompt,
        abortSignal: signal,
        output: Output.object({ schema }),
        ...this.callSettings(context),
      });

      this.emitTelemetry(
        this.primaryModel,
        context,
        startedAt,
        "ok",
        readAiSdkUsage(result.usage),
      );
      return result.output;
    } catch (error) {
      this.emitTelemetry(
        this.primaryModel,
        context,
        startedAt,
        "error",
        undefined,
        error,
      );
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

  private async generateNativeOllamaJson<T>(
    prompt: string,
    schema: z.ZodType<T>,
    context: ModelCallContext,
    signal?: AbortSignal,
  ): Promise<T> {
    const startedAt = performance.now();
    const model = this.nativeOllamaModel;
    if (!model) throw new Error("Native Ollama model is not configured");
    let body = "";
    let usage: ModelCallUsage | undefined;
    let rawText: string | undefined;
    let responseReceived = false;
    try {
      const response = await (this.options.fetch ?? globalThis.fetch)(
        `${this.nativeOllamaBaseUrl}/api/chat`,
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
              temperature: this.options.temperature ?? DEFAULT_TEMPERATURE,
              num_predict:
                context.maxOutputTokens ??
                this.options.maxTokens ??
                DEFAULT_MAX_TOKENS,
            },
          }),
          signal: combineAbortSignals(
            signal,
            AbortSignal.timeout(this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
          ),
        },
      );
      body = await response.text();
      responseReceived = true;
      if (!response.ok) {
        throw new Error(
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
      usage = readOllamaUsage(envelope, rawText);
      const parsed = schema.parse(JSON.parse(rawText));
      this.emitTelemetry(model, context, startedAt, "ok", usage);
      return parsed;
    } catch (error) {
      this.emitTelemetry(model, context, startedAt, "error", usage, error);
      if (!responseReceived) throw error;
      if (
        error instanceof Error &&
        error.message.startsWith("Ollama JSON request failed")
      ) {
        throw error;
      }
      throw new InvalidModelOutputError({
        cause: error,
        rawText: rawText || body,
      });
    }
  }

  private emitTelemetry(
    model: string,
    context: ModelCallContext,
    startedAt: number,
    status: ModelCallTelemetry["status"],
    usage?: ModelCallUsage,
    error?: unknown,
  ): void {
    this.options.onTelemetry?.({
      ...context,
      model,
      durationMs: performance.now() - startedAt,
      status,
      usage,
      ...(error instanceof Error ? { error: error.message } : {}),
    });
  }

  private callSettings(context: ModelCallContext) {
    return {
      timeout: this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxRetries: this.options.maxRetries ?? this.defaultMaxRetries,
      temperature: this.options.temperature ?? DEFAULT_TEMPERATURE,
      maxOutputTokens:
        context.maxOutputTokens ?? this.options.maxTokens ?? DEFAULT_MAX_TOKENS,
    };
  }
}

function readOllamaUsage(
  envelope: Record<string, unknown> & {
    message?: { thinking?: unknown };
  },
  rawText: string,
): ModelCallUsage {
  const inputTokens = readNumber(envelope.prompt_eval_count);
  const generatedTokens = readNumber(envelope.eval_count);
  const reasoningText =
    typeof envelope.message?.thinking === "string"
      ? envelope.message.thinking
      : "";
  return {
    inputTokens,
    generatedTokens,
    reasoningTokens: countTokens(reasoningText),
    outputTokens: countTokens(rawText),
    totalTokens:
      inputTokens !== undefined && generatedTokens !== undefined
        ? inputTokens + generatedTokens
        : undefined,
    ollamaTotalMs: nanosecondsToMilliseconds(envelope.total_duration),
    loadMs: nanosecondsToMilliseconds(envelope.load_duration),
    promptEvalMs: nanosecondsToMilliseconds(envelope.prompt_eval_duration),
    evalMs: nanosecondsToMilliseconds(envelope.eval_duration),
    doneReason:
      typeof envelope.done_reason === "string"
        ? envelope.done_reason
        : undefined,
  };
}

function readAiSdkUsage(value: unknown): ModelCallUsage | undefined {
  if (!isRecord(value)) return undefined;
  return {
    inputTokens: readTokenCount(value.inputTokens),
    outputTokens: readTokenCount(value.outputTokens),
    reasoningTokens:
      readTokenCount(value.reasoningTokens) ??
      (isRecord(value.outputTokenDetails)
        ? readTokenCount(value.outputTokenDetails.reasoningTokens)
        : undefined),
    totalTokens: readTokenCount(value.totalTokens),
  };
}

function readTokenCount(value: unknown): number | undefined {
  return (
    readNumber(value) ?? (isRecord(value) ? readNumber(value.total) : undefined)
  );
}

function nanosecondsToMilliseconds(value: unknown): number | undefined {
  const nanoseconds = readNumber(value);
  return nanoseconds === undefined ? undefined : nanoseconds / 1_000_000;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function combineAbortSignals(
  external: AbortSignal | undefined,
  timeout: AbortSignal,
): AbortSignal {
  return external ? AbortSignal.any([external, timeout]) : timeout;
}

function isOpenRouterUrl(baseUrl: string): boolean {
  const hostname = new URL(baseUrl).hostname.toLowerCase();
  return hostname === "openrouter.ai" || hostname.endsWith(".openrouter.ai");
}

function isNativeOllamaUrl(baseUrl: string): boolean {
  const url = new URL(baseUrl);
  return url.port === "11434";
}

function normalizeNativeOllamaBaseUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  return url.origin;
}

function normalizeBaseUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  const path = url.pathname.replace(/\/+$/, "");

  if (!path.endsWith("/v1")) {
    url.pathname = `${path}/v1`;
  } else {
    url.pathname = path;
  }

  return url.toString().replace(/\/+$/, "");
}

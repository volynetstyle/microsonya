import type { z } from "zod";

export type ModelCallContext = {
  operation: "segment-summary" | "memory-extraction" | "summary-merge";
  chatId?: string;
  commandMessageId?: number;
  segmentId?: string;
  memoryBatch?: number;
  messageCount?: number;
  fromMessageId?: number;
  toMessageId?: number;
  watermarkBefore?: number | null;
  maxOutputTokens?: number;
};

export type ModelCallUsage = {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  generatedTokens?: number;
  totalTokens?: number;
  ollamaTotalMs?: number;
  loadMs?: number;
  promptEvalMs?: number;
  evalMs?: number;
  doneReason?: string;
};

export type ModelCallTelemetry = ModelCallContext & {
  model: string;
  durationMs: number;
  status: "ok" | "error";
  usage?: ModelCallUsage;
  error?: string;
};

export type ModelClient = {
  generateText(
    prompt: string,
    context?: ModelCallContext,
    signal?: AbortSignal,
  ): Promise<string>;
  generateObject<T>(
    prompt: string,
    schema: z.ZodType<T>,
    context?: ModelCallContext,
    signal?: AbortSignal,
  ): Promise<T>;
};

export class InvalidModelOutputError extends Error {
  readonly rawText?: string;

  constructor(options?: ErrorOptions & { rawText?: string }) {
    super("Model output did not match the requested schema.", options);
    this.name = "InvalidModelOutputError";
    this.rawText = options?.rawText;
  }
}

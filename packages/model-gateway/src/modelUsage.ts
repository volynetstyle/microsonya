import { countTokens } from "gpt-tokenizer/encoding/o200k_harmony";
import type { ModelUsage } from "./ModelClient.js";

export function normalizeAiSdkUsage(value: unknown): ModelUsage | undefined {
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

export function normalizeOllamaUsage(
  envelope: Record<string, unknown> & {
    message?: { thinking?: unknown };
  },
  rawText: string,
): ModelUsage {
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

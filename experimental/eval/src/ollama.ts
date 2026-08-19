import type { Reasoning } from "./types.js";
import { countTokens } from "gpt-tokenizer/encoding/o200k_harmony";

export type RunConfig = {
  model: string;
  prompt: string;
  reasoning: Reasoning;
  seed: number;
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
};

export type OllamaResult = {
  content: string;
  thinking: string;
  usage: {
    durationMs: number;
    ollamaTotalMs?: number;
    loadMs?: number;
    promptEvalCount?: number;
    promptEvalMs?: number;
    evalCount?: number;
    thinkingTextTokenCount?: number;
    finalTextTokenCount?: number;
    evalMs?: number;
    outputTokensPerSecond?: number;
    doneReason?: string;
  };
};

export class OllamaRequestError extends Error {
  constructor(
    message: string,
    readonly responseBody = "",
    readonly durationMs = 0,
  ) {
    super(message);
    this.name = "OllamaRequestError";
  }
}

export async function runOllama(config: RunConfig): Promise<OllamaResult> {
  const startedAt = performance.now();
  const baseUrl = (config.baseUrl ?? "http://localhost:11434").replace(
    /\/$/,
    "",
  );
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;
  let response: Response;

  try {
    response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(config.timeoutMs ?? 180_000),
      body: JSON.stringify({
        model: config.model,
        stream: false,
        think: config.reasoning,
        messages: [{ role: "user", content: config.prompt }],
        options: { seed: config.seed, temperature: 1, top_p: 1 },
      }),
    });
  } catch (error) {
    throw new OllamaRequestError(
      error instanceof Error ? error.message : String(error),
      "",
      performance.now() - startedAt,
    );
  }

  const body = await response.text();
  const durationMs = performance.now() - startedAt;

  if (!response.ok) {
    throw new OllamaRequestError(
      `${response.status}: ${body}`,
      body,
      durationMs,
    );
  }

  let result: unknown;
  try {
    result = JSON.parse(body);
  } catch {
    throw new OllamaRequestError(
      "Ollama returned invalid JSON",
      body,
      durationMs,
    );
  }

  if (!isRecord(result) || !isRecord(result.message)) {
    throw new OllamaRequestError(
      "Ollama response has no message object",
      body,
      durationMs,
    );
  }

  const content = readString(result.message.content);
  const thinking = readString(result.message.thinking);
  return {
    content,
    thinking,
    usage: {
      ...readUsage(result, durationMs),
      thinkingTextTokenCount: countTokens(thinking),
      finalTextTokenCount: countTokens(content),
    },
  };
}

function readUsage(
  result: Record<string, unknown>,
  durationMs: number,
): OllamaResult["usage"] {
  const evalCount = readNumber(result.eval_count);
  const evalDurationNs = readNumber(result.eval_duration);
  return {
    durationMs,
    ollamaTotalMs: nanosecondsToMilliseconds(result.total_duration),
    loadMs: nanosecondsToMilliseconds(result.load_duration),
    promptEvalCount: readNumber(result.prompt_eval_count),
    promptEvalMs: nanosecondsToMilliseconds(result.prompt_eval_duration),
    evalCount,
    evalMs: nanosecondsToMilliseconds(evalDurationNs),
    outputTokensPerSecond:
      evalCount !== undefined &&
      evalDurationNs !== undefined &&
      evalDurationNs > 0
        ? evalCount / (evalDurationNs / 1_000_000_000)
        : undefined,
    doneReason: readOptionalString(result.done_reason),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function nanosecondsToMilliseconds(value: unknown): number | undefined {
  const nanoseconds = readNumber(value);
  return nanoseconds === undefined ? undefined : nanoseconds / 1_000_000;
}

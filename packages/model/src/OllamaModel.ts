import type { z } from "zod";
import {
  InvalidModelOutputError,
  ModelRequestError,
  type GenerateOptions,
  type Model,
} from "./Model.js";

export type OllamaModelOptions = {
  host: string;
  model: string;
  temperature?: number;
  reasoning?: "low" | "medium" | "high";
  timeoutMs?: number;
  contextWindow?: number;
  maxOutputTokens?: number;
  fetch?: typeof globalThis.fetch;
};

export class OllamaModel implements Model {
  private readonly host: string;
  constructor(private readonly options: OllamaModelOptions) {
    this.host = new URL(options.host).origin;
  }

  async generate<T>(
    prompt: string,
    schema: z.ZodType<T>,
    options: GenerateOptions = {},
  ): Promise<T> {
    let body = "";
    const signal = options.signal
      ? AbortSignal.any([
          options.signal,
          AbortSignal.timeout(this.options.timeoutMs ?? 60_000),
        ])
      : AbortSignal.timeout(this.options.timeoutMs ?? 60_000);
    const response = await (this.options.fetch ?? globalThis.fetch)(
      `${this.host}/api/chat`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal,
        body: JSON.stringify({
          model: this.options.model,
          stream: false,
          think: this.options.reasoning ?? "low",
          format: "json",
          messages: [{ role: "user", content: prompt }],
          options: {
            temperature: this.options.temperature ?? 0.1,
            num_ctx: this.options.contextWindow ?? 32_768,
            num_predict:
              options.maxOutputTokens ?? this.options.maxOutputTokens ?? 2_500,
          },
        }),
      },
    );
    body = await response.text();
    if (!response.ok)
      throw new ModelRequestError(
        `Ollama request failed (${response.status}): ${body}`,
      );
    try {
      const envelope = JSON.parse(body) as { message?: { content?: unknown } };
      const text = envelope.message?.content;
      if (typeof text !== "string")
        throw new Error("Ollama response has no message content");
      return schema.parse(JSON.parse(text));
    } catch (cause) {
      throw new InvalidModelOutputError({ cause, rawText: body });
    }
  }
}

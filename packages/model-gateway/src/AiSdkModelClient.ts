import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import {
  generateText,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
  type LanguageModel,
} from "ai";
import type { z } from "zod";
import { InvalidModelOutputError, type ModelClient } from "./ModelClient.js";

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
};

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_TEMPERATURE = 0.1;
const DEFAULT_MAX_TOKENS = 1000;

export class AiSdkModelClient implements ModelClient {
  private readonly textModel: LanguageModel;
  private readonly structuredModel: LanguageModel;
  private readonly defaultMaxRetries: number;

  constructor(private readonly options: AiSdkModelClientOptions) {
    const [primaryModel, ...fallbackModels] = options.models;

    if (!primaryModel) {
      throw new Error("At least one model must be configured.");
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

  async generateText(prompt: string): Promise<string> {
    const result = await generateText({
      model: this.textModel,
      prompt,
      ...this.callSettings,
    });

    return result.text;
  }

  async generateObject<T>(prompt: string, schema: z.ZodType<T>): Promise<T> {
    try {
      const result = await generateText({
        model: this.structuredModel,
        prompt,
        output: Output.object({ schema }),
        ...this.callSettings,
      });

      return result.output;
    } catch (error) {
      if (
        NoOutputGeneratedError.isInstance(error) ||
        NoObjectGeneratedError.isInstance(error)
      ) {
        throw new InvalidModelOutputError({ cause: error });
      }

      throw error;
    }
  }

  private get callSettings() {
    return {
      timeout: this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxRetries: this.options.maxRetries ?? this.defaultMaxRetries,
      temperature: this.options.temperature ?? DEFAULT_TEMPERATURE,
      maxOutputTokens: this.options.maxTokens ?? DEFAULT_MAX_TOKENS,
    };
  }
}

function isOpenRouterUrl(baseUrl: string): boolean {
  const hostname = new URL(baseUrl).hostname.toLowerCase();
  return hostname === "openrouter.ai" || hostname.endsWith(".openrouter.ai");
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

import type { ModelClient, ModelResponseFormat } from "../ModelClient.js";
import { FreeModelSwitch } from "../FreeModelSwitch.js";
import type { FreeModelProfile } from "../free-models.js";
import {
  isRetryableModelError,
  ModelRequestError,
  parseRetryAfterMs,
} from "../errors.js";

export type OpenAiCompatibleOptions = {
  baseUrl: string;
  apiKey?: string;
  model?: string;
  models?: string[];
  timeoutMs?: number;
  maxRetries?: number;
  temperature?: number;
  maxTokens?: number;
  appName?: string;
  referer?: string;
  freeModels?: FreeModelProfile[];
  routeLimit?: number;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_MAX_TOKENS = 2048;

export class OpenAiCompatibleClient implements ModelClient {
  private readonly endpoint: URL;
  private readonly freeSwitch: FreeModelSwitch;

  constructor(private readonly options: OpenAiCompatibleOptions) {
    this.endpoint = createChatCompletionsUrl(options.baseUrl);
    this.freeSwitch = new FreeModelSwitch(
      options.models ? toModelProfiles(options.models) : options.freeModels,
    );
  }

  async complete(
    prompt: string,
    responseFormat: ModelResponseFormat = "text",
  ): Promise<string> {
    const data = await this.requestWithModelSwitch(prompt, responseFormat);
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("Model response did not contain message content.");
    }

    return content;
  }

  getFreeModelSwitchSnapshot() {
    return this.freeSwitch.snapshot();
  }

  private async requestWithModelSwitch(
    prompt: string,
    responseFormat: ModelResponseFormat,
  ): Promise<ChatCompletionResponse> {
    if (this.options.models?.length) {
      return this.requestWithFreeSwitch(prompt, responseFormat);
    }

    if (this.options.model) {
      return this.requestWithModels(prompt, responseFormat, [
        this.options.model,
      ]);
    }

    return this.requestWithFreeSwitch(prompt, responseFormat);
  }

  private async requestWithFreeSwitch(
    prompt: string,
    responseFormat: ModelResponseFormat,
  ): Promise<ChatCompletionResponse> {
    const maxRounds = this.options.maxRetries ?? DEFAULT_MAX_RETRIES;
    let lastError: unknown;

    for (let round = 0; round <= maxRounds; round++) {
      const route = this.freeSwitch.getRoute(this.options.routeLimit ?? 2);

      if (route.length === 0) {
        await sleep(this.freeSwitch.getWaitUntilNextAvailableMs());
        continue;
      }

      for (const model of route) {
        const startedAt = Date.now();

        try {
          const response = await this.request(
            this.createBody(prompt, responseFormat, model),
          );
          this.freeSwitch.reportSuccess(model, Date.now() - startedAt);

          return response;
        } catch (error) {
          lastError = error;

          if (!isRetryableModelError(error)) {
            throw error;
          }

          this.freeSwitch.reportFailure(model, {
            status: (error as { status?: number })?.status,
            body: safeErrorBody(error),
            retryAfterMs: parseRetryAfterMs(error),
          });
        }
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("All free models failed.");
  }

  private async requestWithModels(
    prompt: string,
    responseFormat: ModelResponseFormat,
    models: string[],
  ): Promise<ChatCompletionResponse> {
    let lastError: unknown;

    for (const model of models) {
      try {
        return await this.requestWithRetry(
          this.createBody(prompt, responseFormat, model),
        );
      } catch (error) {
        lastError = error;

        if (!isRetryableModelError(error)) {
          throw error;
        }

        const retryAfterMs = parseRetryAfterMs(error);

        if (retryAfterMs !== undefined) {
          await sleep(Math.min(retryAfterMs, 30_000));
        }
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("All configured models failed.");
  }

  private createBody(
    prompt: string,
    responseFormat: ModelResponseFormat,
    model: string,
  ): unknown {
    return {
      model,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: this.options.temperature ?? DEFAULT_TEMPERATURE,
      max_tokens: this.options.maxTokens ?? DEFAULT_MAX_TOKENS,
      ...(responseFormat === "json"
        ? { response_format: { type: "json_object" } }
        : {}),
    };
  }

  private async requestWithRetry(
    body: unknown,
  ): Promise<ChatCompletionResponse> {
    const maxRetries = this.options.maxRetries ?? DEFAULT_MAX_RETRIES;

    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.request(body);
      } catch (error) {
        lastError = error;

        if (!isRetryableError(error) || attempt === maxRetries) {
          throw error;
        }

        await sleep(getRetryDelayMs(attempt));
      }
    }

    throw lastError;
  }

  private async request(body: unknown): Promise<ChatCompletionResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );

    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        signal: controller.signal,
        headers: this.createHeaders(),
        body: JSON.stringify(body),
      });

      const text = await response.text();

      if (!response.ok) {
        throw new ModelRequestError(
          response.status,
          text,
          Object.fromEntries(response.headers.entries()),
        );
      }

      return parseJsonResponse(text);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(
          `Model request timed out after ${this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms.`,
        );
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private createHeaders(): HeadersInit {
    return {
      "content-type": "application/json",
      ...(this.options.apiKey
        ? { authorization: `Bearer ${this.options.apiKey}` }
        : {}),
      ...(this.options.referer ? { "HTTP-Referer": this.options.referer } : {}),
      ...(this.options.appName ? { "X-Title": this.options.appName } : {}),
    };
  }
}

function createChatCompletionsUrl(baseUrl: string): URL {
  const normalized = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const url = new URL(normalized);

  if (url.pathname.endsWith("/v1/")) {
    return new URL("chat/completions", url);
  }

  return new URL("v1/chat/completions", url);
}

function parseJsonResponse(text: string): ChatCompletionResponse {
  try {
    return JSON.parse(text) as ChatCompletionResponse;
  } catch {
    throw new Error(`Model response was not valid JSON: ${text}`);
  }
}

function isRetryableError(error: unknown): boolean {
  return isRetryableModelError(error) || error instanceof TypeError;
}

function getRetryDelayMs(attempt: number): number {
  return 500 * 2 ** attempt;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toModelProfiles(models: string[]): FreeModelProfile[] {
  return models.map((model, index) => ({
    id: model,
    label: model,
    context: 0,
    kind: "summary",
    priority: (models.length - index) * 10,
  }));
}

function safeErrorBody(error: unknown): unknown {
  const body = (error as { body?: unknown })?.body;

  if (typeof body !== "string") {
    return body;
  }

  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

import type { ModelClient, ModelResponseFormat } from "../ModelClient.js";

export type OpenAiCompatibleOptions = {
  baseUrl: string;
  apiKey?: string;
  model: string;
  timeoutMs?: number;
  maxRetries?: number;
  temperature?: number;
  maxTokens?: number;
  appName?: string;
  referer?: string;
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

  constructor(private readonly options: OpenAiCompatibleOptions) {
    this.endpoint = createChatCompletionsUrl(options.baseUrl);
  }

  async complete(
    prompt: string,
    responseFormat: ModelResponseFormat = "text",
  ): Promise<string> {
    const body = {
      model: this.options.model,
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

    const data = await this.requestWithRetry(body);
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("Model response did not contain message content.");
    }

    return content;
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
        throw new ModelRequestError(response.status, text);
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

class ModelRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`Model request failed: ${status} ${body}`);
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
  if (error instanceof ModelRequestError) {
    return [408, 409, 425, 429, 500, 502, 503, 504].includes(error.status);
  }

  return error instanceof TypeError;
}

function getRetryDelayMs(attempt: number): number {
  return 500 * 2 ** attempt;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

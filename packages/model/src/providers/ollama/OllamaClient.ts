import type {
  GenerateRequestNonStreaming,
  GenerateRequestStreaming,
  GenerateResponse,
  GenerateStreamEvent,
  ChatRequestNonStreaming,
  ChatRequestStreaming,
  ChatResponse,
  ChatStreamEvent,
  EmbedRequest,
  EmbedResponse,
  OllamaErrorBody,
} from "./OllamaTypes.js";

export interface OllamaClientConfig {
  /** Base URL up to and including `/api`. Default: `http://localhost:11434/api`. */
  baseUrl?: string;
  /** Bearer token for `https://ollama.com/api` (the `OLLAMA_API_KEY` value). Unused for local access — see api/authentication. */
  apiKey?: string;
  /** Extra headers merged into every request (apiKey's Authorization header wins on conflict). */
  headers?: Record<string, string>;
  /** Override fetch (e.g. a polyfill, or a wrapped/instrumented fetch). Defaults to `globalThis.fetch`. */
  fetch?: typeof fetch;
}

export interface RequestOpts {
  signal?: AbortSignal;
}

const DEFAULT_BASE_URL = "http://localhost:11434/api";

/**
 * Thrown for both:
 *  - pre-stream HTTP errors: non-2xx status with an `{"error": "..."}` body, and
 *  - in-stream errors: an ndjson line containing only `error`, which the server
 *    can still emit after status 200 was already sent (headers are committed
 *    before generation starts, so a mid-stream failure can't change the status
 *    line — see https://docs.ollama.com/api/errors).
 *
 * `status` reflects the HTTP status of the response the error was found on,
 * which for an in-stream error is the original `200`, not a synthesized code.
 */
export class OllamaError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "OllamaError";
    this.status = status;
  }
}

function isErrorBody(x: unknown): x is OllamaErrorBody {
  return (
    typeof x === "object" &&
    x !== null &&
    typeof (x as Record<string, unknown>).error === "string"
  );
}

export class OllamaClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly fetchImpl: typeof fetch;

  constructor(config: OllamaClientConfig = {}) {
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.headers = {
      "Content-Type": "application/json",
      ...config.headers,
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    };

    const impl = config.fetch ?? globalThis.fetch;
    if (!impl) {
      throw new Error(
        "No `fetch` available in this runtime; pass one via `config.fetch`.",
      );
    }
    this.fetchImpl = impl.bind(globalThis);
  }

  // ---------------------------------------------------------------------
  // /api/generate
  // ---------------------------------------------------------------------

  generate(
    request: GenerateRequestNonStreaming,
    opts?: RequestOpts,
  ): Promise<GenerateResponse>;
  generate(
    request: GenerateRequestStreaming,
    opts?: RequestOpts,
  ): AsyncGenerator<GenerateStreamEvent, void, void>;
  generate(
    request: GenerateRequestNonStreaming | GenerateRequestStreaming,
    opts: RequestOpts = {},
  ):
    | Promise<GenerateResponse>
    | AsyncGenerator<GenerateStreamEvent, void, void> {
    return request.stream
      ? this.stream<GenerateStreamEvent>("/generate", request, opts)
      : this.call<GenerateResponse>("/generate", request, opts);
  }

  // ---------------------------------------------------------------------
  // /api/chat
  // ---------------------------------------------------------------------

  chat(
    request: ChatRequestNonStreaming,
    opts?: RequestOpts,
  ): Promise<ChatResponse>;
  chat(
    request: ChatRequestStreaming,
    opts?: RequestOpts,
  ): AsyncGenerator<ChatStreamEvent, void, void>;
  chat(
    request: ChatRequestNonStreaming | ChatRequestStreaming,
    opts: RequestOpts = {},
  ): Promise<ChatResponse> | AsyncGenerator<ChatStreamEvent, void, void> {
    return request.stream
      ? this.stream<ChatStreamEvent>("/chat", request, opts)
      : this.call<ChatResponse>("/chat", request, opts);
  }

  // ---------------------------------------------------------------------
  // /api/embed — no `stream` variant exists for this endpoint in the spec.
  // ---------------------------------------------------------------------

  embed(request: EmbedRequest, opts: RequestOpts = {}): Promise<EmbedResponse> {
    return this.call<EmbedResponse>("/embed", request, opts);
  }

  // ---------------------------------------------------------------------
  // internals
  // ---------------------------------------------------------------------

  private async call<T>(
    path: string,
    body: unknown,
    opts: RequestOpts,
  ): Promise<T> {
    const res = await this.fetchImpl(this.baseUrl + path, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(body),
      signal: opts.signal,
    });

    let payload: unknown;
    try {
      payload = await res.json();
    } catch (cause) {
      if (!res.ok) throw new OllamaError(res.statusText, res.status);
      throw new OllamaError(
        `Response body was not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
        res.status,
      );
    }

    if (!res.ok || isErrorBody(payload)) {
      throw new OllamaError(
        isErrorBody(payload) ? payload.error : res.statusText,
        res.status,
      );
    }
    return payload as T;
  }

  /**
   * Reads `application/x-ndjson`: one JSON object per line. A `fetch` response
   * body delivers arbitrary byte chunks — a chunk boundary has no relationship
   * to a line boundary — so chunks are decoded and buffered, and only text up
   * to the last `\n` in the buffer is split into candidate lines on each read.
   * `TextDecoder`'s `stream: true` mode is load-bearing here too: it holds back
   * a trailing partial multi-byte UTF-8 sequence instead of emitting U+FFFD.
   */
  private async *stream<T extends { done: boolean }>(
    path: string,
    body: unknown,
    opts: RequestOpts,
  ): AsyncGenerator<T, void, void> {
    const res = await this.fetchImpl(this.baseUrl + path, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(body),
      signal: opts.signal,
    });

    if (!res.ok) {
      // Failed before any stream bytes were produced — body is plain JSON, not ndjson.
      let message = res.statusText;
      try {
        const errBody = (await res.json()) as OllamaErrorBody;
        if (typeof errBody?.error === "string") message = errBody.error;
      } catch {
        // Not JSON — fall back to statusText.
      }
      throw new OllamaError(message, res.status);
    }
    if (!res.body) {
      throw new OllamaError("Response had no body to stream.", res.status);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const parseLine = (line: string): T => {
      const parsed = JSON.parse(line) as T | OllamaErrorBody;
      if (isErrorBody(parsed)) {
        // Status is 200 here — the error surfaced after headers were already sent.
        throw new OllamaError(parsed.error, res.status);
      }
      return parsed;
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          if (line) yield parseLine(line);
        }
      }

      const trailing = buffer.trim();
      if (trailing) yield parseLine(trailing);
    } finally {
      reader.releaseLock();
    }
  }
}

/**
 * Type definitions for the Ollama HTTP API — /api/generate, /api/chat, /api/embed.
 *
 * Source of truth: https://docs.ollama.com/api/{generate,chat,embed} (OpenAPI 3.1
 * schemas embedded in those pages), captured 2026-08-24.
 *
 * `ModelOptions` is declared with `additionalProperties: true` in the spec — the
 * runtime accepts more Modelfile PARAMETER keys (mirostat, repeat_penalty, num_gpu,
 * etc.) than are enumerated in this reference page. Rather than fabricate a list
 * that isn't actually documented here, known fields are typed and everything else
 * flows through the index signature untyped. Widen `ModelOptions` locally if you
 * need stricter typing for a specific option.
 */

/** `"5m"`-style duration string, or a number of seconds; `0` unloads immediately. */
export type KeepAlive = string | number;

export type ThinkLevel = "high" | "medium" | "low" | "max";
/** `true`/`false` toggles thinking; a level string requests a specific effort tier. */
export type ThinkOption = boolean | ThinkLevel;

/** JSON Schema object, used both for structured-output `format` and tool `parameters`. */
export type JSONSchema = Record<string, unknown>;

/** `"json"` for unstructured JSON mode, or a full JSON Schema for structured outputs. */
export type ResponseFormat = "json" | JSONSchema;

export interface ModelOptions {
  seed?: number;
  temperature?: number;
  top_k?: number;
  top_p?: number;
  min_p?: number;
  stop?: string | string[];
  num_ctx?: number;
  num_predict?: number;
  /** additionalProperties: true in the spec — anything else the runtime accepts. */
  [key: string]: unknown;
}

export interface TokenLogprob {
  token: string;
  logprob: number;
  bytes?: number[];
}

export interface Logprob extends TokenLogprob {
  /** Most likely alternative tokens at this position, when `top_logprobs` was set. */
  top_logprobs?: TokenLogprob[];
}

export interface GenerateRequestBase {
  model: string;
  prompt?: string;
  /** Fill-in-the-middle: text that follows the response, for models that support it. */
  suffix?: string;
  /** Base64-encoded images, for vision models. */
  images?: string[];
  format?: ResponseFormat;
  system?: string;
  think?: ThinkOption;
  /** Skip prompt templating and send `prompt` to the model verbatim. */
  raw?: boolean;
  keep_alive?: KeepAlive;
  options?: ModelOptions;
  logprobs?: boolean;
  top_logprobs?: number;
}

/**
 * The wire default for `stream` is `true` (see streaming.md). This client makes
 * `stream` a required field instead of defaulting it, because the return type
 * (`Promise<...>` vs `AsyncGenerator<...>`) has to be picked statically at the
 * call site — an implicit server-side default can't drive an overload. Callers
 * must say which shape they want.
 */
export type GenerateRequest = GenerateRequestBase & { stream: boolean };
export type GenerateRequestNonStreaming = GenerateRequestBase & {
  stream: false;
};
export type GenerateRequestStreaming = GenerateRequestBase & { stream: true };

export interface GenerateResponse {
  model: string;
  created_at: string;
  response: string;
  thinking?: string;
  done: boolean;
  done_reason?: string;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
  logprobs?: Logprob[];
}

/** One ndjson chunk from a streaming `/api/generate` call. Final chunk has `done: true`. */
export interface GenerateStreamEvent {
  model: string;
  created_at: string;
  response: string;
  thinking?: string;
  done: boolean;
  done_reason?: string;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  function: {
    name: string;
    description?: string;
    arguments: Record<string, unknown>;
  };
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  images?: string[];
  tool_calls?: ToolCall[];
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description?: string;
    /** JSON Schema for the function's arguments. */
    parameters: JSONSchema;
  };
}

export interface ChatRequestBase {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  format?: ResponseFormat;
  options?: ModelOptions;
  think?: ThinkOption;
  keep_alive?: KeepAlive;
  logprobs?: boolean;
  top_logprobs?: number;
}

/** See the note on `GenerateRequest` — same reasoning applies here. */
export type ChatRequest = ChatRequestBase & { stream: boolean };
export type ChatRequestNonStreaming = ChatRequestBase & { stream: false };
export type ChatRequestStreaming = ChatRequestBase & { stream: true };

export interface ChatResponseMessage {
  role: "assistant";
  content: string;
  thinking?: string;
  tool_calls?: ToolCall[];
  images?: string[];
}

export interface ChatResponse {
  model: string;
  created_at: string;
  message: ChatResponseMessage;
  done: boolean;
  done_reason?: string;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
  logprobs?: Logprob[];
}

export interface ChatStreamMessage {
  role: string;
  content: string;
  thinking?: string;
  tool_calls?: ToolCall[];
  images?: string[];
}

/** One ndjson chunk from a streaming `/api/chat` call. Final chunk has `done: true`. */
export interface ChatStreamEvent {
  model: string;
  created_at: string;
  message: ChatStreamMessage;
  done: boolean;
}

export interface EmbedRequest {
  model: string;
  input: string | string[];
  /** If true (default), inputs longer than the context window are truncated; if false, an error is returned instead. */
  truncate?: boolean;
  dimensions?: number;
  keep_alive?: KeepAlive;
  options?: ModelOptions;
}

export interface EmbedResponse {
  model: string;
  /** One vector per input, in input order. */
  embeddings: number[][];
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
}

/**
 * The only documented error shape, used both for pre-stream HTTP failures
 * (4xx/5xx with this body) and for errors that occur mid-stream (an ndjson
 * line containing only this field, emitted after status 200 was already sent).
 */
export interface OllamaErrorBody {
  error: string;
}

// api
export { OllamaClient, OllamaError } from "./OllamaClient.js";
// types
export type { OllamaClientConfig, RequestOpts } from "./OllamaClient.js";

export type {
  // shared
  KeepAlive,
  ThinkLevel,
  ThinkOption,
  JSONSchema,
  ResponseFormat,
  ModelOptions,
  Logprob,
  TokenLogprob,
  // generate
  GenerateRequest,
  GenerateRequestNonStreaming,
  GenerateRequestStreaming,
  GenerateResponse,
  GenerateStreamEvent,
  // chat
  ChatRole,
  ChatMessage,
  ChatRequest,
  ChatRequestNonStreaming,
  ChatRequestStreaming,
  ChatResponse,
  ChatResponseMessage,
  ChatStreamEvent,
  ChatStreamMessage,
  ToolCall,
  ToolDefinition,
  // embed
  EmbedRequest,
  EmbedResponse,
  // errors
  OllamaErrorBody,
} from "./OllamaTypes.js";

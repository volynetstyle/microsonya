import type { ChatRequestNonStreaming } from "../providers/ollama/index.js";

/** Static inference configuration. The caller supplies per-request messages. */
export type OllamaChatProfile = Omit<
  ChatRequestNonStreaming,
  "messages" | "stream"
>;

/** GPT-OSS accepts reasoning levels, not the generic Ollama boolean toggle. */
export type GptOssChatProfile = Omit<OllamaChatProfile, "think"> & {
  think?: "low" | "medium" | "high";
};

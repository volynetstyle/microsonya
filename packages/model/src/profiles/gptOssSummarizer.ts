import type { GptOssChatProfile } from "./OllamaChatProfile.js";

export const SUMMARIZER_PROFILE = {
  model: "gpt-oss:120b-cloud",
  think: "low",
  options: {
    temperature: 1.0,
    top_p: 1.0,
    top_k: 0,
    min_p: 0.0,
    num_ctx: 131072,
    num_predict: 8192,
  },
} satisfies GptOssChatProfile;

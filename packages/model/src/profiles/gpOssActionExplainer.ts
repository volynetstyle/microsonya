import type { GptOssChatProfile } from "./OllamaChatProfile.js";

// quality = fidelity + clarity+ naturalness − invention
export const ACTION_EXPLAINER_PROFILE = {
  model: "gpt-oss:20b-cloud",
  think: "low",
  format: "json",
  options: {
    temperature: 0.7,
    top_k: 8,
    top_p: 1,
    min_p: 0,
    num_ctx: 32_768,
    num_predict: 256,
    repeat_penalty: 1,
    presence_penalty: 0,
    frequency_penalty: 0,
  },
} satisfies GptOssChatProfile;
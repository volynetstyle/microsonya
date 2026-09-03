import type { GptOssChatProfile } from "./OllamaChatProfile.js";

export const SUMMARIZER_PROFILE = {
  model: "gpt-oss:120b-cloud",
  think: "low",
  options: {
    temperature: 0.1,
    num_ctx: 32_768,
    num_predict: 2_500,
  },
} satisfies GptOssChatProfile;

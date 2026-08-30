import type { GptOssChatProfile } from "./OllamaChatProfile.js";

export const CLASSIFIER_PROFILE = {
  model: "gpt-oss:120b-cloud",
  think: "low",

  format: "json",

  options: {
    temperature: 0,
    top_k: 1,
    top_p: 1,
    min_p: 0,
    num_ctx: 32_768,
    num_predict: 512,
    repeat_penalty: 1,
    presence_penalty: 0,
    frequency_penalty: 0,
  },
} satisfies GptOssChatProfile;

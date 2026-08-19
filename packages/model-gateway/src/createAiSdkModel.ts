import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

export type CreateAiSdkModelOptions = {
  baseUrl: string;
  apiKey?: string;
  modelId: string;
  appName?: string;
  referer?: string;
  fetch?: typeof globalThis.fetch;
};

/** Builds one AI SDK language model against a generic OpenAI-compatible endpoint. */
export function createAiSdkModel(options: CreateAiSdkModelOptions): LanguageModel {
  const provider = createOpenAICompatible({
    name: "openaiCompatible",
    baseURL: normalizeBaseUrl(options.baseUrl),
    apiKey: options.apiKey,
    headers: {
      ...(options.referer ? { "HTTP-Referer": options.referer } : {}),
      ...(options.appName ? { "X-Title": options.appName } : {}),
    },
    fetch: options.fetch,
    supportsStructuredOutputs: true,
  });

  return provider.chatModel(options.modelId);
}

function normalizeBaseUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  const path = url.pathname.replace(/\/+$/, "");

  if (!path.endsWith("/v1")) {
    url.pathname = `${path}/v1`;
  } else {
    url.pathname = path;
  }

  return url.toString().replace(/\/+$/, "");
}

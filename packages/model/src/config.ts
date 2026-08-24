import type { OllamaClientConfig } from "./providers/ollama/index.js";

export type OllamaConfig = Pick<OllamaClientConfig, "baseUrl" | "apiKey">;

export function loadOllamaConfig(
  env: NodeJS.ProcessEnv = process.env,
): OllamaConfig {
  const host = env.OLLAMA_HOST?.trim() || "http://localhost:11434";
  return {
    baseUrl: `${host.replace(/\/+$/, "").replace(/\/api$/, "")}/api`,
    apiKey: env.OLLAMA_API_KEY?.trim() || undefined,
  };
}

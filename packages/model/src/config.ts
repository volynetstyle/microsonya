export type ModelConfig = { host: string; model: string };

export function loadModelConfig(
  env: NodeJS.ProcessEnv = process.env,
): ModelConfig {
  return {
    host: env.OLLAMA_HOST?.trim() || "http://localhost:11434",
    model: env.OLLAMA_MODEL?.trim() || "gpt-oss:120b-cloud",
  };
}

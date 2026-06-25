import "dotenv/config";

export type AppConfig = {
  telegramToken: string;
  databaseUrl: string;
  llmBaseUrl: string;
  llmModel: string;
  llmApiKey?: string;
};

export function readConfig(): AppConfig {
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!telegramToken) {
    throw new Error("TELEGRAM_BOT_TOKEN is required.");
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  return {
    telegramToken,
    databaseUrl,
    llmBaseUrl: process.env.LLM_BASE_URL ?? "https://openrouter.ai/api/v1/",
    llmModel: process.env.LLM_MODEL ?? "qwen/qwen3-next-80b-a3b-instruct:free",
    llmApiKey: process.env.LLM_API_KEY ?? process.env.OPENROUTER_TOKEN
  };
}

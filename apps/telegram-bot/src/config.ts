import "dotenv/config";

export type AppConfig = {
  telegramToken: string;
  dbPath: string;
  llmBaseUrl: string;
  llmModel: string;
  llmApiKey?: string;
};

export function readConfig(): AppConfig {
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!telegramToken) {
    throw new Error("TELEGRAM_BOT_TOKEN is required.");
  }

  return {
    telegramToken,
    dbPath: process.env.MICROSONYA_DB ?? "microsonya.sqlite",
    llmBaseUrl: process.env.LLM_BASE_URL ?? "http://localhost:11434",
    llmModel: process.env.LLM_MODEL ?? "qwen2.5:7b",
    llmApiKey: process.env.LLM_API_KEY
  };
}

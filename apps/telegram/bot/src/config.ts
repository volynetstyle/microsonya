import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv();

for (const envPath of [
  resolve(process.cwd(), ".env"),
  resolve(process.cwd(), "../../.env"),
  resolve(process.cwd(), "../../../.env"),
]) {
  if (existsSync(envPath)) {
    loadEnv({ path: envPath });
  }
}

export type AppConfig = {
  telegramToken: string;
  databaseUrl: string;
  llmBaseUrl: string;
  llmModel?: string;
  llmModels?: string[];
  llmQuarantineModels?: string[];
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
  validateDatabaseUrl(databaseUrl);

  return {
    telegramToken,
    databaseUrl,
    llmBaseUrl: process.env.LLM_BASE_URL ?? "https://openrouter.ai/api/v1/",
    llmModel: process.env.LLM_MODEL,
    llmModels: parseModels(process.env.LLM_MODELS),
    llmQuarantineModels: parseModels(process.env.LLM_QUARANTINE_MODELS),
    llmApiKey: process.env.LLM_API_KEY ?? process.env.OPENROUTER_TOKEN,
  };
}

function validateDatabaseUrl(databaseUrl: string): void {
  try {
    new URL(databaseUrl);
  } catch {
    throw new Error(
      "DATABASE_URL must be a valid Postgres URL. Encode special password characters, for example # as %23.",
    );
  }
}

function parseModels(value: string | undefined): string[] | undefined {
  const models = value
    ?.split(",")
    .map((model) => model.trim())
    .filter(Boolean);

  return models && models.length > 0 ? models : undefined;
}

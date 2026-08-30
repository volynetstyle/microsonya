import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import { loadOllamaConfig, type OllamaConfig } from "@microsonya/model";

loadEnv();

for (const envPath of [
  resolve(process.cwd(), ".env"),
  resolve(process.cwd(), "../../.env"),
  resolve(process.cwd(), "../../../.env"),
]) {
  if (existsSync(envPath)) {
    loadEnv({ path: envPath, override: false });
  }
}

export type AppConfig = {
  telegramToken: string;
  databaseUrl?: string;
  dataEncryptionKey?: string;
  ollama: OllamaConfig;
};

export function readConfig(): AppConfig {
  const telegramToken = requiredEnv("TELEGRAM_BOT_TOKEN");
  const databaseUrl = optionalEnv("DATABASE_URL");
  const dataEncryptionKey =
    optionalEnv("MICROSONYA_DATA_ENCRYPTION_KEY") ??
    optionalEnv("SUMMARY_LEDGER_ENCRYPTION_KEY");

  if (process.env.NODE_ENV === "production" && databaseUrl === undefined) {
    throw new Error("DATABASE_URL is required in production.");
  }
  if (
    process.env.NODE_ENV === "production" &&
    (process.env.SUMMARIZATION_LOG_PROMPT === "1" ||
      process.env.SUMMARIZATION_LOG_MODEL_RESPONSE === "1")
  ) {
    throw new Error(
      "Full prompt/model-response logging is forbidden in production.",
    );
  }
  if (databaseUrl !== undefined && dataEncryptionKey === undefined) {
    throw new Error(
      "MICROSONYA_DATA_ENCRYPTION_KEY is required when DATABASE_URL is set.",
    );
  }

  return {
    telegramToken,
    databaseUrl,
    dataEncryptionKey,
    ollama: loadOllamaConfig(process.env),
  };
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

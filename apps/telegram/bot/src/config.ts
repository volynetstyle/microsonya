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
  summaryLedgerEncryptionKey?: string;
  ollama: OllamaConfig;
};

export function readConfig(): AppConfig {
  const telegramToken = requiredEnv("TELEGRAM_BOT_TOKEN");
  const databaseUrl = optionalEnv("DATABASE_URL");
  const summaryLedgerEncryptionKey = optionalEnv(
    "SUMMARY_LEDGER_ENCRYPTION_KEY",
  );

  if (process.env.NODE_ENV === "production" && databaseUrl === undefined) {
    throw new Error("DATABASE_URL is required in production.");
  }
  if (databaseUrl !== undefined && summaryLedgerEncryptionKey === undefined) {
    throw new Error(
      "SUMMARY_LEDGER_ENCRYPTION_KEY is required when DATABASE_URL is set.",
    );
  }

  return {
    telegramToken,
    databaseUrl,
    summaryLedgerEncryptionKey,
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

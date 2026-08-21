import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import { loadModelConfig, type ModelConfig } from "@microsonya/model";

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
  databaseUrl: string;

  model: ModelConfig;
};

export function readConfig(): AppConfig {
  const telegramToken = requiredEnv("TELEGRAM_BOT_TOKEN");

  const databaseUrl = requiredEnv("DATABASE_URL");
  validateDatabaseUrl(databaseUrl);

  return {
    telegramToken,

    databaseUrl,

    model: loadModelConfig(process.env),
  };
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

function validateDatabaseUrl(databaseUrl: string): void {
  let url: URL;

  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error(
      "DATABASE_URL must be a valid Postgres URL. Encode special password characters, for example # as %23.",
    );
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use postgres:// or postgresql://.");
  }
  if (url.hash) {
    throw new Error(
      "DATABASE_URL must be a valid Postgres URL. Encode special password characters, for example # as %23.",
    );
  }
}

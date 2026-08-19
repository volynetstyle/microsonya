import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import { loadModelConfig, type ModelConfig } from "@microsonya/model-gateway";

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

export type StorageMode = "postgres" | "memory";

export type AppConfig = {
  telegramToken: string;

  storageMode: StorageMode;

  databaseUrl?: string;
  memoryFilePath: string;

  /** Public URL of the Web Mini App (apps/telegram/wma). Unset disables the /app command. */
  wmaUrl?: string;

  /** All model configuration lives here; see @microsonya/model-gateway's modelConfig module. */
  llm: ModelConfig;
};

export function readConfig(): AppConfig {
  const telegramToken = requiredEnv("TELEGRAM_BOT_TOKEN");

  const storageMode = parseStorageMode(process.env.STORAGE_MODE);

  const databaseUrl = process.env.DATABASE_URL;

  if (storageMode === "postgres") {
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required when STORAGE_MODE=postgres.");
    }

    validateDatabaseUrl(databaseUrl);
  }

  return {
    telegramToken,

    storageMode,

    databaseUrl,
    memoryFilePath: resolve(
      process.cwd(),
      process.env.MEMORY_FILE_PATH?.trim() || ".data/memory.json",
    ),

    wmaUrl: process.env.WMA_URL?.trim() || undefined,

    llm: loadModelConfig(process.env),
  };
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

function parseStorageMode(value: string | undefined): StorageMode {
  switch (normalizeMode(value ?? "memory")) {
    case "postgres":
    case "postgresql":
    case "database":
    case "db":
      return "postgres";

    case "memory":
    case "inmemory":
    case "in-memory":
    case "mem":
      return "memory";

    default:
      throw new Error(
        `Unknown STORAGE_MODE "${value}". Supported values: postgres, memory.`,
      );
  }
}

function normalizeMode(value: string): string {
  return value.trim().toLowerCase();
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

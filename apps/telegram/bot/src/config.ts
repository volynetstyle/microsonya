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
    loadEnv({ path: envPath, override: false });
  }
}

export type StorageMode = "postgres" | "memory";
export type ModelsMode = "openai-compatible" | "disabled";

export type AppConfig = {
  telegramToken: string;

  storageMode: StorageMode;
  modelsMode: ModelsMode;

  databaseUrl?: string;

  llmBaseUrl: string;
  llmModel?: string;
  llmModels?: string[];
  llmQuarantineModels?: string[];
  llmApiKey?: string;
};

export function readConfig(): AppConfig {
  const telegramToken = requiredEnv("TELEGRAM_BOT_TOKEN");

  const storageMode = parseStorageMode(process.env.STORAGE_MODE);
  const modelsMode = parseModelsMode(process.env.MODELS_MODE);

  const databaseUrl = process.env.DATABASE_URL;

  if (storageMode === "postgres") {
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required when STORAGE_MODE=postgres.");
    }

    validateDatabaseUrl(databaseUrl);
  }

  const llmBaseUrl = process.env.LLM_BASE_URL ?? "https://openrouter.ai/api/v1/";
  const llmModel = process.env.LLM_MODEL;
  const llmApiKey = process.env.LLM_API_KEY ?? process.env.OPENROUTER_TOKEN;

  if (modelsMode === "openai-compatible") {
    if (!llmModel) {
      throw new Error("LLM_MODEL is required when MODELS_MODE=openai-compatible.");
    }

    if (!llmApiKey) {
      throw new Error(
        "LLM_API_KEY or OPENROUTER_TOKEN is required when MODELS_MODE=openai-compatible.",
      );
    }
  }

  return {
    telegramToken,

    storageMode,
    modelsMode,

    databaseUrl,

    llmBaseUrl,
    llmModel,
    llmModels: parseList(process.env.LLM_MODELS),
    llmQuarantineModels: parseList(process.env.LLM_QUARANTINE_MODELS),
    llmApiKey,
  };
}

function requiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

function parseStorageMode(value: string | undefined): StorageMode {
  switch (normalizeMode(value ?? "postgres")) {
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

function parseModelsMode(value: string | undefined): ModelsMode {
  switch (normalizeMode(value ?? "openai-compatible")) {
    case "openai-compatible":
    case "openai":
    case "openrouter":
    case "llm":
    case "enabled":
      return "openai-compatible";

    case "disabled":
    case "none":
    case "off":
      return "disabled";

    default:
      throw new Error(
        `Unknown MODELS_MODE "${value}". Supported values: openai-compatible, disabled.`,
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
}

function parseList(value: string | undefined): string[] | undefined {
  const items = value
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return items && items.length > 0 ? items : undefined;
}
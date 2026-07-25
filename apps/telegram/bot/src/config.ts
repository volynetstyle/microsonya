import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import {
  DEFAULT_MERGE_MODEL,
  FREE_SUMMARY_MODELS,
} from "@microsonya/model-gateway";

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

  llm: {
    baseUrl: string;
    apiKey?: string;

    /**
     * Models available for use after excluding quarantined models.
     */
    models?: string[];
    mergeModel: string;

    /**
     * Models explicitly forbidden from use.
     */
    quarantineModels?: string[];
  };
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

  const llmBaseUrl =
    process.env.LLM_BASE_URL ?? "https://openrouter.ai/api/v1/";

  const configuredModels = parseList(
    process.env.LLM_MODELS ??
      process.env.LLM_MODEL ??
      FREE_SUMMARY_MODELS.map((model) => model.id).join(","),
  );

  const quarantineModels = parseList(process.env.LLM_QUARANTINE_MODELS);

  const models = excludeValues(configuredModels, quarantineModels);

  const llmApiKey = process.env.LLM_API_KEY ?? process.env.OPENROUTER_TOKEN;

  if (modelsMode === "openai-compatible") {
    if (!models?.length) {
      throw new Error(
        "At least one usable model is required when MODELS_MODE=openai-compatible. Configure LLM_MODELS or LLM_MODEL and ensure not all models are quarantined.",
      );
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

    llm: {
      baseUrl: llmBaseUrl,
      apiKey: llmApiKey,
      models,
      mergeModel: process.env.LLM_MERGE_MODEL ?? DEFAULT_MERGE_MODEL,
      quarantineModels,
    },
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

function excludeValues(
  values: string[] | undefined,
  excluded: string[] | undefined,
): string[] | undefined {
  if (!values?.length) {
    return undefined;
  }

  if (!excluded?.length) {
    return values;
  }

  const excludedSet = new Set(excluded);
  const result = values.filter((value) => !excludedSet.has(value));

  return result.length > 0 ? result : undefined;
}

function parseList(value: string | undefined): string[] | undefined {
  const items = value
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (!items?.length) {
    return undefined;
  }

  return [...new Set(items)];
}

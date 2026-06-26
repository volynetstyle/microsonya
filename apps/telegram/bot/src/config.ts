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
  disabledServices: ReadonlySet<ExternalService>;
  databaseUrl?: string;
  llmBaseUrl: string;
  llmModel?: string;
  llmModels?: string[];
  llmQuarantineModels?: string[];
  llmApiKey?: string;
};

export type ExternalService = "db" | "llm";

export function readConfig(): AppConfig {
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!telegramToken) {
    throw new Error("TELEGRAM_BOT_TOKEN is required.");
  }
  const disabledServices = parseDisabledServices(
    process.env.MICROSONYA_DISABLED_SERVICES,
  );
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl && !disabledServices.has("db")) {
    throw new Error("DATABASE_URL is required.");
  }
  if (databaseUrl) {
    validateDatabaseUrl(databaseUrl);
  }

  return {
    telegramToken,
    disabledServices,
    databaseUrl,
    llmBaseUrl: process.env.LLM_BASE_URL ?? "https://openrouter.ai/api/v1/",
    llmModel: process.env.LLM_MODEL,
    llmModels: parseModels(process.env.LLM_MODELS),
    llmQuarantineModels: parseModels(process.env.LLM_QUARANTINE_MODELS),
    llmApiKey: process.env.LLM_API_KEY ?? process.env.OPENROUTER_TOKEN
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

function parseDisabledServices(value: string | undefined): ReadonlySet<ExternalService> {
  const services = new Set<ExternalService>();

  for (const service of parseModels(value) ?? []) {
    switch (service.toLowerCase()) {
      case "database":
      case "postgres":
      case "postgresql":
        services.add("db");
        break;
      case "models":
      case "model":
      case "openrouter":
      case "openai":
        services.add("llm");
        break;
      case "db":
        services.add("db");
        break;
      case "llm":
        services.add("llm");
        break;
      default:
        throw new Error(
          `Unknown disabled service "${service}". Supported values: db, llm.`,
        );
    }
  }

  return services;
}

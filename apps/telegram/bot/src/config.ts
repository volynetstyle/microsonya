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

  ollama: OllamaConfig;
};

export function readConfig(): AppConfig {
  const telegramToken = requiredEnv("TELEGRAM_BOT_TOKEN");

  return {
    telegramToken,
    ollama: loadOllamaConfig(process.env),
  };
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

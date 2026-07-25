import { afterEach, describe, expect, it } from "vitest";
import { readConfig } from "../apps/telegram/bot/src/config.js";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("readConfig", () => {
  it("accepts OPENROUTER_TOKEN as the LLM API key fallback", () => {
    process.env.TELEGRAM_BOT_TOKEN = "telegram-token";
    process.env.DATABASE_URL = "postgresql://localhost/microsonya";
    delete process.env.LLM_API_KEY;
    process.env.OPENROUTER_TOKEN = "openrouter-token";

    expect(readConfig()).toMatchObject({
      telegramToken: "telegram-token",
      llm: {
        apiKey: "openrouter-token",
      },
    });
  });

  it("prefers LLM_API_KEY when both key variables are set", () => {
    process.env.TELEGRAM_BOT_TOKEN = "telegram-token";
    process.env.DATABASE_URL = "postgresql://localhost/microsonya";
    process.env.LLM_API_KEY = "llm-token";
    process.env.OPENROUTER_TOKEN = "openrouter-token";

    expect(readConfig().llm.apiKey).toBe("llm-token");
  });

  it("parses comma-separated LLM_MODELS", () => {
    process.env.TELEGRAM_BOT_TOKEN = "telegram-token";
    process.env.DATABASE_URL = "postgresql://localhost/microsonya";
    process.env.LLM_MODELS = "first:free, second:free,, third:free ";
    process.env.LLM_QUARANTINE_MODELS = "bad:free, worse:free";

    expect(readConfig().llm.models).toEqual([
      "first:free",
      "second:free",
      "third:free",
    ]);
    expect(readConfig().llm.quarantineModels).toEqual([
      "bad:free",
      "worse:free",
    ]);
  });

  it("uses separate defaults for segment fallback and text merge", () => {
    process.env.TELEGRAM_BOT_TOKEN = "telegram-token";
    process.env.DATABASE_URL = "postgresql://localhost/microsonya";
    delete process.env.LLM_MODEL;
    delete process.env.LLM_MODELS;
    delete process.env.LLM_MERGE_MODEL;
    delete process.env.LLM_QUARANTINE_MODELS;

    const config = readConfig();

    expect(config.llm.models).toEqual([
      "nvidia/nemotron-3-super-120b-a12b:free",
      "openai/gpt-oss-20b:free",
      "google/gemma-4-26b-a4b-it:free",
      "nvidia/nemotron-nano-9b-v2:free",
      "openrouter/free",
    ]);
    expect(config.llm.mergeModel).toBe("openrouter/free");
  });

  it("allows in-memory storage for bot-only exploration", () => {
    process.env.TELEGRAM_BOT_TOKEN = "telegram-token";
    process.env.STORAGE_MODE = "memory";
    delete process.env.DATABASE_URL;

    expect(readConfig()).toMatchObject({
      telegramToken: "telegram-token",
      databaseUrl: undefined,
      storageMode: "memory",
    });
  });

  it("parses explicit storage and model mode aliases", () => {
    process.env.TELEGRAM_BOT_TOKEN = "telegram-token";
    process.env.STORAGE_MODE = "mem";
    process.env.MODELS_MODE = "off";
    delete process.env.DATABASE_URL;

    const config = readConfig();

    expect(config.storageMode).toBe("memory");
    expect(config.modelsMode).toBe("disabled");
  });

  it("rejects unknown service modes", () => {
    process.env.TELEGRAM_BOT_TOKEN = "telegram-token";
    process.env.DATABASE_URL = "postgresql://localhost/microsonya";
    process.env.MODELS_MODE = "cache";

    expect(() => readConfig()).toThrow(/Unknown MODELS_MODE "cache"/);
  });

  it("fails early for invalid database urls", () => {
    process.env.TELEGRAM_BOT_TOKEN = "telegram-token";
    process.env.DATABASE_URL = "postgresql://user:pass#@localhost/db";

    expect(() => readConfig()).toThrow(
      /DATABASE_URL must be a valid Postgres URL/,
    );
  });
});

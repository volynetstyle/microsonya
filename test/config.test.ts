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

  it("defaults to a local Ollama endpoint and model", () => {
    process.env.TELEGRAM_BOT_TOKEN = "telegram-token";
    process.env.DATABASE_URL = "postgresql://localhost/microsonya";
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_MODEL;
    delete process.env.LLM_MODELS;
    delete process.env.LLM_MERGE_MODEL;
    delete process.env.LLM_MEMORY_MODEL;
    delete process.env.LLM_QUARANTINE_MODELS;
    delete process.env.LLM_API_KEY;
    delete process.env.OPENROUTER_TOKEN;

    const config = readConfig();

    expect(config.llm.baseUrl).toBe("http://localhost:11434");
    expect(config.llm.structuredOutputTransport).toBe("ollama-native");
    expect(config.llm.models).toEqual(["gpt-oss:120b-cloud"]);
    expect(config.llm.mergeModel).toBeUndefined();
    expect(config.llm.memoryModel).toBe("gpt-oss:20b-cloud");
  });

  it("accepts an explicit structured-output transport instead of guessing from the base url", () => {
    process.env.TELEGRAM_BOT_TOKEN = "telegram-token";
    process.env.DATABASE_URL = "postgresql://localhost/microsonya";
    process.env.LLM_STRUCTURED_TRANSPORT = "openai-compatible";

    expect(readConfig().llm.structuredOutputTransport).toBe("openai-compatible");
  });

  it("rejects unknown structured-output transports", () => {
    process.env.TELEGRAM_BOT_TOKEN = "telegram-token";
    process.env.DATABASE_URL = "postgresql://localhost/microsonya";
    process.env.LLM_STRUCTURED_TRANSPORT = "carrier-pigeon";

    expect(() => readConfig()).toThrow(
      /Unknown LLM_STRUCTURED_TRANSPORT "carrier-pigeon"/,
    );
  });

  it("allows a dedicated smaller memory model", () => {
    process.env.TELEGRAM_BOT_TOKEN = "telegram-token";
    process.env.DATABASE_URL = "postgresql://localhost/microsonya";
    process.env.LLM_MEMORY_MODEL = "memory-small";

    expect(readConfig().llm.memoryModel).toBe("memory-small");
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
    expect(config.llm.mode).toBe("disabled");
  });

  it("rejects unknown service modes", () => {
    process.env.TELEGRAM_BOT_TOKEN = "telegram-token";
    process.env.DATABASE_URL = "postgresql://localhost/microsonya";
    process.env.MODELS_MODE = "cache";

    expect(() => readConfig()).toThrow(/Unknown MODELS_MODE "cache"/);
  });

  it("fails early for invalid database urls", () => {
    process.env.TELEGRAM_BOT_TOKEN = "telegram-token";
    process.env.STORAGE_MODE = "postgres";
    process.env.DATABASE_URL = "postgresql://user:pass#@localhost/db";

    expect(() => readConfig()).toThrow(
      /DATABASE_URL must be a valid Postgres URL/,
    );
  });

  it("permits local auth-free APIs without an API key", () => {
    process.env.TELEGRAM_BOT_TOKEN = "telegram-token";
    process.env.STORAGE_MODE = "memory";
    process.env.LLM_BASE_URL = "http://localhost:11434/v1";
    delete process.env.DATABASE_URL;
    delete process.env.LLM_API_KEY;
    delete process.env.OPENROUTER_TOKEN;

    expect(() => readConfig()).not.toThrow();
  });
});

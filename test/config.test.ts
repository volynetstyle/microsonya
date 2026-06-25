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
      llmApiKey: "openrouter-token",
    });
  });

  it("prefers LLM_API_KEY when both key variables are set", () => {
    process.env.TELEGRAM_BOT_TOKEN = "telegram-token";
    process.env.DATABASE_URL = "postgresql://localhost/microsonya";
    process.env.LLM_API_KEY = "llm-token";
    process.env.OPENROUTER_TOKEN = "openrouter-token";

    expect(readConfig().llmApiKey).toBe("llm-token");
  });

  it("parses comma-separated LLM_MODELS", () => {
    process.env.TELEGRAM_BOT_TOKEN = "telegram-token";
    process.env.DATABASE_URL = "postgresql://localhost/microsonya";
    process.env.LLM_MODELS = "first:free, second:free,, third:free ";
    process.env.LLM_QUARANTINE_MODELS = "bad:free, worse:free";

    expect(readConfig().llmModels).toEqual([
      "first:free",
      "second:free",
      "third:free",
    ]);
    expect(readConfig().llmQuarantineModels).toEqual([
      "bad:free",
      "worse:free",
    ]);
  });

  it("fails early for invalid database urls", () => {
    process.env.TELEGRAM_BOT_TOKEN = "telegram-token";
    process.env.DATABASE_URL = "postgresql://user:pass#@localhost/db";

    expect(() => readConfig()).toThrow(/DATABASE_URL must be a valid Postgres URL/);
  });
});

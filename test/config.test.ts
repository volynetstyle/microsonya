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
});

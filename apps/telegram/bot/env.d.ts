declare global {
  namespace NodeJS {
    interface ProcessEnv {
      NODE_ENV?: "development" | "production" | "test";
      TELEGRAM_BOT_TOKEN?: string;
      MICROSONYA_DISABLED_SERVICES?: string;
      DATABASE_URL?: string;
      LLM_BASE_URL?: string;
      LLM_MODEL?: string;
      LLM_MODELS?: string;
      LLM_QUARANTINE_MODELS?: string;
      LLM_API_KEY?: string;
      OPENROUTER_TOKEN?: string;
    }
  }
}

export {};

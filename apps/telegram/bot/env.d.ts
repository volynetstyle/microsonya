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
      LLM_MERGE_MODEL?: string;
      LLM_QUARANTINE_MODELS?: string;
      LLM_ROUTER_MODE?: string;
      LLM_ROUTER_CHEAP_MODEL?: string;
      LLM_ROUTER_DEFAULT_MODEL?: string;
      LLM_ROUTER_QUALITY_MODEL?: string;
      LLM_ROUTER_DEFAULT_MIN_INPUT_TOKENS?: string;
      LLM_ROUTER_QUALITY_MIN_INPUT_TOKENS?: string;
      LLM_ROUTER_FAILURE_THRESHOLD?: string;
      LLM_ROUTER_CIRCUIT_COOLDOWN_MS?: string;
      LLM_API_KEY?: string;
      OPENROUTER_TOKEN?: string;
    }
  }
}

export {};

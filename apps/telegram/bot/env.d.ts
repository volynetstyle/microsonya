declare global {
  namespace NodeJS {
    interface ProcessEnv {
      NODE_ENV?: "development" | "production" | "test";
      TELEGRAM_BOT_TOKEN?: string;
      DATABASE_URL?: string;
      OLLAMA_HOST?: string;
      OLLAMA_MODEL?: string;
    }
  }
}

export {};

import type { AppConfig } from "./config.js";
import { launchWithRetry } from "./launchWithRetry.js";
import { createServices } from "./services.js";
import { createTelegramBot } from "./telegramBot.js";

export type App = {
  start(): Promise<void>;
  stop(reason?: string): void;
};

export function createApp(config: AppConfig): App {
  const services = createServices(config);
  const bot = createTelegramBot(config, services);
  const shutdown = new AbortController();

  return {
    async start() {
      await launchWithRetry(() => bot.launch(), {
        signal: shutdown.signal,
        shouldRetry: isRetryableTelegramLaunchError,
        onRetry(error, delayMs) {
          console.error(
            `Telegram launch failed; retrying in ${delayMs} ms`,
            error,
          );
        },
      });
    },
    stop(reason = "shutdown") {
      shutdown.abort();

      try {
        bot.stop(reason);
      } catch {
        // Telegraf throws when startup failed before polling began.
      }
    },
  };
}

export function isRetryableTelegramLaunchError(error: unknown): boolean {
  const status = telegramErrorCode(error);
  return status === undefined || status === 429 || status >= 500;
}

function telegramErrorCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("response" in error)) {
    return undefined;
  }

  const response = error.response;
  if (typeof response !== "object" || response === null) return undefined;
  if (!("error_code" in response) || typeof response.error_code !== "number") {
    return undefined;
  }

  return response.error_code;
}

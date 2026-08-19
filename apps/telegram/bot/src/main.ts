import { readConfig } from "./config.js";
import {
  launchWithRetry,
  isRetryableTelegramError,
} from "./launchWithRetry.js";
import { createMemoryModels, createModels } from "./models.js";
import { createStorage } from "./storage.js";
import { telegramCommands as summarizeCommands } from "./commands/summarize.js";
import { telegramCommands as webappCommands } from "./commands/webapp.js";
import { createTelegramBot } from "./telegramBot.js";

const telegramCommands = [...summarizeCommands, ...webappCommands];

const config = readConfig();
const bot = createTelegramBot(config, {
  storage: createStorage(config),
  models: createModels(config),
  memoryModels: createMemoryModels(config),
  wmaUrl: config.wmaUrl,
});
const shutdown = new AbortController();

function stop(reason: string): void {
  shutdown.abort();
  try {
    bot.stop(reason);
  } catch {
    // Telegraf can throw if polling never started.
  }
}

process.once("SIGINT", () => stop("SIGINT"));
process.once("SIGTERM", () => stop("SIGTERM"));

await launchWithRetry(
  async () => {
    await bot.telegram.setMyCommands(telegramCommands);
    await bot.launch();
  },
  {
    signal: shutdown.signal,
    shouldRetry: isRetryableTelegramError,
    onRetry(error, delayMs) {
      console.error(`Telegram launch failed; retrying in ${delayMs} ms`, error);
    },
  },
);

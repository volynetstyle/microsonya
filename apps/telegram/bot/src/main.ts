import { readConfig } from "./config.js";
import {
  launchWithRetry,
  isRetryableTelegramError,
} from "./launchWithRetry.js";
import { createModels } from "./models.js";
import { createStorage } from "./storage.js";
import { telegramCommands as summarizeCommands } from "./commands/summarize.js";
import { telegramCommands as webappCommands } from "./commands/webapp.js";
import { createTelegramBot } from "./telegramBot.js";
import {
  createSummarizer,
  SummarizationTelemetryService,
} from "@microsonya/summarize";

const telegramCommands = [...summarizeCommands, ...webappCommands];

const config = readConfig();
const storage = createStorage(config);
const models = createModels(config);
const summarizer = models
  ? createSummarizer({
      messages: storage.messages,
      summaries: storage.summaries,
      models,
      telemetry: new SummarizationTelemetryService(),
    })
  : undefined;
const bot = createTelegramBot(config, {
  storage,
  summarizer,
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

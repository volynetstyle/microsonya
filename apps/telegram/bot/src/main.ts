import { readConfig } from "./config.js";
import {
  launchWithRetry,
  isRetryableTelegramError,
} from "./launchWithRetry.js";
import { OllamaModel, withTelemetry } from "@microsonya/model";
import { createStorage } from "./storage.js";
import { telegramCommands as summarizeCommands } from "./commands/summarize.js";
import { createTelegramBot } from "./telegramBot.js";
import {
  createSummarizer,
  SummarizationTelemetryService,
} from "@microsonya/summarize";

const telegramCommands = summarizeCommands;

const config = readConfig();
const storage = createStorage(config);
const model = withTelemetry(new OllamaModel(config.model), (event) =>
  console.info("Model telemetry", JSON.stringify(event)),
);
const summarizer = createSummarizer({
  messages: storage.messages,
  summaries: storage.summaries,
  model,
  telemetry: new SummarizationTelemetryService(),
});
const bot = createTelegramBot(config, {
  storage,
  summarizer,
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

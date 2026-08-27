import { readConfig } from "./config.js";
import {
  launchWithRetry,
  isRetryableTelegramError,
} from "./launchWithRetry.js";
import { OllamaClient, withTelemetry } from "@microsonya/model";
import {
  MessagesRepo,
  SummariesRepo,
  ledgerEncryptionFromBase64,
  openDb,
} from "@microsonya/db";
import { Telegraf } from "telegraf";
import { createStorage } from "./storage.js";
import { telegramCommands } from "./command.js";
import { createMessageHandler } from "./telegramHandlers.js";
import {
  createSummarizer,
  SummarizationTelemetryService,
} from "@microsonya/summarize";

const config = readConfig();
const dbClient =
  config.databaseUrl === undefined ? undefined : openDb(config.databaseUrl);
const storage =
  dbClient === undefined
    ? createStorage()
    : {
        messages: new MessagesRepo(dbClient.db),
        summaries: new SummariesRepo(
          dbClient.db,
          ledgerEncryptionFromBase64(config.summaryLedgerEncryptionKey!),
        ),
      };
const ollama = new OllamaClient({
  ...config.ollama,
  fetch: withTelemetry(globalThis.fetch, (event) =>
    console.info("Model telemetry", JSON.stringify(event)),
  ),
});
const summarizer = createSummarizer({
  messages: storage.messages,
  summaries: storage.summaries,
  ollama,
  telemetry: new SummarizationTelemetryService(),
});
const bot = new Telegraf(config.telegramToken);
bot.on(
  "message",
  createMessageHandler({
    messages: storage.messages,
    summarizer,
  }),
);
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

try {
  await launchWithRetry(
    async () => {
      await bot.telegram.setMyCommands(telegramCommands);
      await bot.launch();
    },
    {
      signal: shutdown.signal,
      shouldRetry: isRetryableTelegramError,
      onRetry(error, delayMs) {
        console.error(
          `Telegram launch failed; retrying in ${delayMs} ms`,
          error,
        );
      },
    },
  );
} finally {
  await dbClient?.close();
}

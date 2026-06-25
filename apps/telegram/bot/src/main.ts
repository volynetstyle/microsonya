import { MessagesRepo, openDb, SummariesRepo } from "@microsonya/db";
import {
  ModelGateway,
  OpenAiCompatibleClient,
} from "@microsonya/model-gateway";
import { summarize } from "@microsonya/summarize";
import { Telegraf } from "telegraf";
import { parseSummaryCommand } from "./commands/summarize.js";
import { readConfig } from "./config.js";
import { ingestMessage } from "./telegram/ingest.js";
import {
  isForwardedMessage,
  toChatMessage,
  type TelegramMessageLike,
} from "./telegram/message.js";

const config = readConfig();

const { db } = openDb(config.databaseUrl);

const messages = new MessagesRepo(db);
const summaries = new SummariesRepo(db);

const models = new ModelGateway(
  new OpenAiCompatibleClient({
    baseUrl: config.llmBaseUrl,
    apiKey: config.llmApiKey,
    model: config.llmModel,
    models: filterQuarantinedModels(
      config.llmModels,
      config.llmQuarantineModels,
    ),
  }),
);

const bot = new Telegraf(config.telegramToken);

bot.on("message", async (ctx) => {
  try {
    const telegramMessage = ctx.message as TelegramMessageLike;
    const chatMessage = toChatMessage(telegramMessage);

    await ingestMessage(messages, chatMessage);

    const text = telegramMessage.text;

    if (!text || isForwardedMessage(telegramMessage)) {
      return;
    }

    const command = parseSummaryCommand(
      chatMessage.chatId,
      chatMessage.id,
      telegramMessage.date * 1000,
      text,
    );

    if (!command) {
      return;
    }

    const summarizeStartedAt = Date.now();
    const summaryText = await summarize(
      { messages, summaries, models },
      command,
    );
    const summarizeMs = Date.now() - summarizeStartedAt;

    const replyStartedAt = Date.now();
    await ctx.reply(summaryText);
    console.log(
      "Summary command completed",
      safeStringify({
        chatId: command.chatId,
        commandMessageId: command.commandMessageId,
        summarizeMs,
        replyMs: Date.now() - replyStartedAt,
        totalMs: Date.now() - summarizeStartedAt,
      }),
    );
    logModelStats(models.getModelStats());
  } catch (error) {
    console.error(
      "Failed to process Telegram update",
      formatErrorForLog(error),
    );

    if (isModelRateLimitError(error)) {
      await ctx.reply(formatRateLimitMessage(error));
      return;
    }

    await ctx.reply(
      "Не вдалося підготувати підсумок. Я вже зафіксував помилку. Спробуй ще раз трохи пізніше.",
    );
  }
});

await bot.launch();

function isModelRateLimitError(error: unknown): error is Error {
  return (
    error instanceof Error &&
    error.message.includes("Model request failed: 429")
  );
}

function formatRateLimitMessage(error: Error): string {
  const retryAfter = getRetryAfterSeconds(error.message);

  if (retryAfter) {
    return `Зараз модель обробляє занадто багато запитів. Спробуй ще раз приблизно через ${retryAfter} с.`;
  }

  return "Зараз модель обробляє занадто багато запитів. Спробуй ще раз трохи пізніше.";
}

function getRetryAfterSeconds(message: string): number | undefined {
  const match = message.match(/"retry_after_seconds"\s*:\s*(\d+)/);

  if (!match) {
    return undefined;
  }

  return Number(match[1]);
}

function formatErrorForLog(error: unknown): string {
  if (!(error instanceof Error)) {
    return safeStringify(error);
  }

  return safeStringify({
    name: error.name,
    message: error.message,
    stack: error.stack,
    status: (error as { status?: unknown }).status,
    body: truncateString((error as { body?: unknown }).body),
  });
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncateString(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  return value.length > 2_000 ? `${value.slice(0, 2_000)}...` : value;
}

function filterQuarantinedModels(
  models: string[] | undefined,
  quarantine: string[] | undefined,
): string[] | undefined {
  if (!models || !quarantine?.length) {
    return models;
  }

  const blocked = new Set(quarantine);
  return models.filter((model) => !blocked.has(model));
}

function logModelStats(stats: unknown[]): void {
  if (stats.length === 0) {
    return;
  }

  try {
    console.table(stats);
  } catch {
    console.log("Model stats", safeStringify(stats));
  }
}

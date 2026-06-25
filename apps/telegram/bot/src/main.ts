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
    models: config.llmModels,
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

    const summaryText = await summarize(
      { messages, summaries, models },
      command,
    );

    await ctx.reply(summaryText);
  } catch (error) {
    console.error("Failed to process Telegram update", error);

    if (isModelRateLimitError(error)) {
      await ctx.reply(formatRateLimitMessage(error));
      return;
    }

    await ctx.reply(
      "Не получилось сделать summary. Я уже залогировал ошибку, попробуй ещё раз чуть позже.",
    );
  }
});

await bot.launch();

function isModelRateLimitError(error: unknown): error is Error {
  return error instanceof Error && error.message.includes("Model request failed: 429");
}

function formatRateLimitMessage(error: Error): string {
  const retryAfter = getRetryAfterSeconds(error.message);

  if (retryAfter) {
    return `Модель временно упёрлась в rate limit. Попробуй ещё раз примерно через ${retryAfter} сек.`;
  }

  return "Модель временно упёрлась в rate limit. Попробуй ещё раз через минуту.";
}

function getRetryAfterSeconds(message: string): number | undefined {
  const match = message.match(/"retry_after_seconds"\s*:\s*(\d+)/);

  if (!match) {
    return undefined;
  }

  return Number(match[1]);
}

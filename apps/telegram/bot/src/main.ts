import { MessagesRepo, openDb, SummariesRepo } from "@microsonya/db";
import {
  ModelGateway,
  OpenAiCompatibleClient,
} from "@microsonya/model-gateway";
import { summarize } from "@microsonya/summarize";
import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { parseSummaryCommand } from "./commands/summarize.js";
import { readConfig } from "./config.js";
import { ingestMessage } from "./telegram/ingest.js";

const config = readConfig();

const { db } = openDb(config.databaseUrl);

const messages = new MessagesRepo(db);
const summaries = new SummariesRepo(db);

const models = new ModelGateway(
  new OpenAiCompatibleClient({
    baseUrl: config.llmBaseUrl,
    apiKey: config.llmApiKey,
    model: config.llmModel,
  }),
);

const bot = new Telegraf(config.telegramToken);

bot.on(message("text"), async (ctx) => {
  const telegramMessage = ctx.message;
  const chatId = String(telegramMessage.chat.id);
  const date = telegramMessage.date * 1000;
  const text = telegramMessage.text;

  await ingestMessage(messages, {
    id: telegramMessage.message_id,
    chatId,
    date,
    authorId: String(telegramMessage.from.id),
    authorName: [
      telegramMessage.from.first_name,
      telegramMessage.from.last_name,
    ]
      .filter(Boolean)
      .join(" "),
    text,
    replyToId: telegramMessage.reply_to_message?.message_id,
    kind: "text",
    isCommand: text.startsWith("/"),
  });

  const command = parseSummaryCommand(
    chatId,
    telegramMessage.message_id,
    date,
    text,
  );

  if (!command) {
    return;
  }

  const summaryText = await summarize({ messages, summaries, models }, command);

  await ctx.reply(summaryText);
});

await bot.launch();

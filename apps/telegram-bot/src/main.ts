import { MessagesRepo, openDb, SummariesRepo } from "@microsonya/db";
import { ModelGateway, OpenAiCompatibleClient } from "@microsonya/model-gateway";
import { summarize } from "@microsonya/summarize";
import { Telegraf } from "telegraf";
import { parseSummaryCommand } from "./commands/summarize.js";
import { readConfig } from "./config.js";
import { ingestMessage } from "./telegram/ingest.js";

const config = readConfig();
const { db } = openDb(config.dbPath);
const messages = new MessagesRepo(db);
const summaries = new SummariesRepo(db);
const models = new ModelGateway(
  new OpenAiCompatibleClient({
    baseUrl: config.llmBaseUrl,
    apiKey: config.llmApiKey,
    model: config.llmModel
  })
);

const bot = new Telegraf(config.telegramToken);

bot.on("text", async (ctx) => {
  const message = ctx.message;
  const chatId = String(message.chat.id);
  const date = message.date * 1000;
  const text = message.text;

  ingestMessage(messages, {
    id: message.message_id,
    chatId,
    date,
    authorId: String(message.from.id),
    authorName: [message.from.first_name, message.from.last_name].filter(Boolean).join(" "),
    text,
    replyToId: message.reply_to_message?.message_id,
    kind: "text",
    isCommand: text.startsWith("/")
  });

  const command = parseSummaryCommand(chatId, message.message_id, date, text);
  if (!command) {
    return;
  }

  await ctx.reply(await summarize({ messages, summaries, models }, command));
});

await bot.launch();

import { summarize } from "@microsonya/summarize";
import type { Context } from "telegraf";
import { parseSummaryCommand } from "./commands/summarize.js";
import type { AppServices } from "./services.js";
import { ingestMessage } from "./telegram/ingest.js";
import {
  isForwardedMessage,
  toChatMessage,
  type TelegramMessageLike,
} from "./telegram/message.js";
import {
  formatErrorForLog,
  formatRateLimitMessage,
  isModelRateLimitError,
  logModelStats,
  safeStringify,
} from "./errors.js";

export function createMessageHandler(services: AppServices) {
  return async function handleMessage(ctx: Context): Promise<void> {
    try {
      const telegramMessage = ctx.message as TelegramMessageLike;
      const chatMessage = toChatMessage(telegramMessage);

      await ingestMessage(services.storage.messages, chatMessage);

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

      if (!services.models) {
        await ctx.reply(
          "Підсумки вимкнені, бо MICROSONYA_DISABLED_SERVICES містить llm.",
        );
        return;
      }

      const startedAt = Date.now();

      const summaryText = await summarize(
        {
          messages: services.storage.messages,
          summaries: services.storage.summaries,
          models: services.models,
        },
        command,
      );

      const summarizeMs = Date.now() - startedAt;

      const replyStartedAt = Date.now();
      await ctx.reply(summaryText);

      console.log(
        "Summary command completed",
        safeStringify({
          chatId: command.chatId,
          commandMessageId: command.commandMessageId,
          summarizeMs,
          replyMs: Date.now() - replyStartedAt,
          totalMs: Date.now() - startedAt,
        }),
      );

      logModelStats(services.models.getModelStats());
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
  };
}
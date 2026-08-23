import type { Summarizer } from "@microsonya/summarize";
import type { Context } from "telegraf";
import { toCommandInvocation } from "./commands/telegram.js";
import { parseSummarizeArgs, toSummaryCommand } from "./commands/summarize.js";
import type { Storage } from "./storage.js";
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
  safeStringify,
} from "./errors.js";
import { createNativeDraftTransport } from "./telegram/nativeDraftTransport.js";
import { SummaryPresentationSession } from "./summaryPresentation.js";

export type BotServices = {
  storage: Storage;
  summarizer: Summarizer;
};

export function createMessageHandler(services: BotServices) {
  return async function handleMessage(ctx: Context): Promise<void> {
    const updateStartedAt = Date.now();
    let commandContext:
      | { chatId: string; commandMessageId: number }
      | undefined;
    let summaryOutput: SummaryPresentationSession | undefined;

    try {
      const telegramMessage = ctx.message as TelegramMessageLike;
      const chatMessage = toChatMessage(telegramMessage);

      const ingestStartedAt = Date.now();
      await ingestMessage(services.storage.messages, chatMessage);
      const ingestMs = Date.now() - ingestStartedAt;

      if (isForwardedMessage(telegramMessage)) {
        return;
      }

      const commandParseStartedAt = Date.now();
      const invocation = toCommandInvocation(telegramMessage, ctx.me);
      if (!invocation) return;

      if (invocation.name !== "summary") {
        return;
      }
      const args = parseSummarizeArgs(invocation.args);
      if (!args) return;
      const command = toSummaryCommand(invocation, args);

      commandContext = {
        chatId: command.chatId,
        commandMessageId: command.commandMessageId,
      };
      const commandParseMs = Date.now() - commandParseStartedAt;

      const output = new SummaryPresentationSession(
        ctx.chat?.type === "private"
          ? createNativeDraftTransport(ctx)
          : undefined,
        async (text) => {
          await ctx.reply(text);
        },
      );
      summaryOutput = output;

      const startedAt = Date.now();

      await output.status("Аналізую…");
      const summaryText = await services.summarizer.summarize(command);

      const summarizeMs = Date.now() - startedAt;

      const replyStartedAt = Date.now();
      await output.complete(
        summaryText ?? "Немає нових повідомлень для підсумку.",
      );

      console.log(
        "Summary command completed",
        safeStringify({
          chatId: command.chatId,
          commandMessageId: command.commandMessageId,
          ingestMs,
          commandParseMs,
          preSummarizeMs: startedAt - updateStartedAt,
          summarizeMs,
          replyMs: Date.now() - replyStartedAt,
          totalMs: Date.now() - updateStartedAt,
        }),
      );
    } catch (error) {
      console.error(
        "Failed to process Telegram update",
        formatErrorForLog(error),
        safeStringify({
          ...commandContext,
          failedAfterMs: Date.now() - updateStartedAt,
        }),
      );

      if (isAbortError(error)) {
        if (summaryOutput) await summaryOutput.fail("Скасовано.");
        else await ctx.reply("Скасовано.");
        return;
      }

      const message = isModelRateLimitError(error)
        ? formatRateLimitMessage(error)
        : "Не вдалося підготувати підсумок. Я вже зафіксував помилку. Спробуй ще раз трохи пізніше.";
      if (summaryOutput) await summaryOutput.fail(message);
      else await ctx.reply(message);
    }
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
}

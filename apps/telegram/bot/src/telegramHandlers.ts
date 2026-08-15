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
  safeStringify,
} from "./errors.js";
import {
  LatencyAwareDisclosure,
  type DisclosureTransport,
} from "./summaryDisclosure.js";

const activeSummaries = new Map<
  string,
  { controller: AbortController; disclosure: LatencyAwareDisclosure }
>();

export function createMessageHandler(services: AppServices) {
  return async function handleMessage(ctx: Context): Promise<void> {
    const updateStartedAt = Date.now();
    let commandContext:
      | { chatId: string; commandMessageId: number }
      | undefined;
    let activeSummaryKey: string | undefined;
    let disclosure: LatencyAwareDisclosure | undefined;
    try {
      const telegramMessage = ctx.message as TelegramMessageLike;
      const chatMessage = toChatMessage(telegramMessage);

      const ingestStartedAt = Date.now();
      await ingestMessage(services.storage.messages, chatMessage);
      const ingestMs = Date.now() - ingestStartedAt;

      const text = telegramMessage.text;

      if (!text || isForwardedMessage(telegramMessage)) {
        return;
      }

      const commandParseStartedAt = Date.now();
      const command = parseSummaryCommand(
        chatMessage.chatId,
        chatMessage.id,
        telegramMessage.date * 1000,
        text,
      );

      if (!command) {
        return;
      }
      commandContext = {
        chatId: command.chatId,
        commandMessageId: command.commandMessageId,
      };
      const commandParseMs = Date.now() - commandParseStartedAt;

      if (!services.models) {
        await ctx.reply("Підсумки вимкнені, бо MODELS_MODE=disabled.");
        return;
      }

      const controller = new AbortController();
      disclosure = new LatencyAwareDisclosure(
        createDisclosureTransport(ctx, command.commandMessageId),
      );
      disclosure.start();
      activeSummaryKey = summaryKey(command.chatId, command.commandMessageId);
      activeSummaries.set(activeSummaryKey, { controller, disclosure });

      const startedAt = Date.now();

      const summaryText = await summarize(
        {
          memory: services.storage.memory,
          messages: services.storage.messages,
          summaries: services.storage.summaries,
          models: services.models,
          memoryModels: services.memoryModels,
          onTrace: (event) => disclosure?.onTrace(event),
          signal: controller.signal,
        },
        command,
      );

      const summarizeMs = Date.now() - startedAt;

      const replyStartedAt = Date.now();
      await disclosure.finish(summaryText);

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
          totalMs: Date.now() - startedAt,
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
        const handled = (await disclosure?.fail("Скасовано.")) ?? false;
        if (!handled) await ctx.reply("Скасовано.");
        return;
      }

      const message = isModelRateLimitError(error)
        ? formatRateLimitMessage(error)
        : "Не вдалося підготувати підсумок. Я вже зафіксував помилку. Спробуй ще раз трохи пізніше.";
      const handled = (await disclosure?.fail(message)) ?? false;
      if (!handled) await ctx.reply(message);
    } finally {
      if (activeSummaryKey) activeSummaries.delete(activeSummaryKey);
    }
  };
}

export function createCancelSummaryHandler() {
  return async function handleCancelSummary(ctx: Context): Promise<void> {
    const callback = ctx.callbackQuery;
    const data =
      callback && "data" in callback && typeof callback.data === "string"
        ? callback.data
        : "";
    const match = /^cancel_summary:(\d+)$/u.exec(data);
    const chatId = ctx.chat?.id;
    if (!match || chatId === undefined) return;

    const entry = activeSummaries.get(
      summaryKey(String(chatId), Number(match[1])),
    );
    if (!entry) {
      await ctx.answerCbQuery("Цей запит уже завершено.");
      return;
    }

    entry.disclosure.cancelling();
    entry.controller.abort(new DOMException("Cancelled by user", "AbortError"));
    await ctx.answerCbQuery("Скасовую…");
  };
}

function createDisclosureTransport(
  ctx: Context,
  commandMessageId: number,
): DisclosureTransport {
  const chatId = ctx.chat?.id;
  if (chatId === undefined) {
    throw new Error("Telegram context has no chat ID");
  }

  return {
    sendTyping: async () => {
      await ctx.sendChatAction("typing");
    },
    sendStatus: async (text, cancellable) => {
      const message = await ctx.reply(text, {
        reply_markup: cancelMarkup(commandMessageId, cancellable),
      });
      return message.message_id;
    },
    editStatus: async (messageId, text, cancellable) => {
      await ctx.telegram.editMessageText(chatId, messageId, undefined, text, {
        reply_markup: cancelMarkup(commandMessageId, cancellable),
      });
    },
    sendFinal: async (text) => {
      await ctx.reply(text);
    },
  };
}

function cancelMarkup(commandMessageId: number, enabled: boolean) {
  return {
    inline_keyboard: enabled
      ? [
          [
            {
              text: "Скасувати",
              callback_data: `cancel_summary:${commandMessageId}`,
            },
          ],
        ]
      : [],
  };
}

function summaryKey(chatId: string, commandMessageId: number): string {
  return `${chatId}:${commandMessageId}`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
}

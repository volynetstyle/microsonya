import { presentDisposition, type Summarizer } from "@microsonya/summarize";
import type { ChatMessage } from "@microsonya/shared";
import type { Context } from "telegraf";
import { parseSummaryCommand } from "./command.js";
import { formatRateLimitMessage, isModelRateLimitError } from "./errors.js";
import { ReplySession } from "./replySession.js";
import { fromTelegram, type TelegramMessageLike } from "./telegram/message.js";
import { createNativeDraftTransport } from "./telegram/nativeDraftTransport.js";

export type BotServices = {
  messages: { save(message: ChatMessage): Promise<void> };
  summarizer: Pick<Summarizer, "process">;
  onError?: (event: {
    readonly code: "DELIVERY_ERROR";
    readonly error: unknown;
  }) => void;
};

export function createMessageHandler(services: BotServices) {
  return async function handleMessage(ctx: Context): Promise<void> {
    const telegramMessage = ctx.message as TelegramMessageLike;

    const command = parseSummaryCommand(telegramMessage, ctx.me);
    const reply = command ? createReplySession(ctx) : undefined;
    let finalText: string;

    try {
      const message = fromTelegram(telegramMessage, {
        selfAuthorId:
          ctx.botInfo === undefined ? undefined : String(ctx.botInfo.id),
      });
      if (message) await services.messages.save(message);

      if (!command || !reply) return;

      await reply.progress("Аналізую");
      const disposition = await services.summarizer.process(command);
      finalText = disposition
        ? presentDisposition(disposition)
        : "Немає нових повідомлень для підсумку.";
    } catch (error) {
      // An ordinary message must never receive a summary-specific error reply.
      if (!reply) throw error;
      finalText = formatSummaryFailure(error);
    }

    // Delivery errors are infrastructure failures, not summary failures.
    try {
      await reply.finish(finalText);
    } catch (error) {
      const event = {
        code: "DELIVERY_ERROR",
        error,
      } as const;
      if (services.onError) services.onError(event);
      else console.error("[summary:delivery-error]", event);
      throw error;
    }
  };
}

export function formatSummaryFailure(error: unknown): string {
  if (isAbortError(error)) return "Скасовано.";
  if (isModelRateLimitError(error)) return formatRateLimitMessage(error);
  return "Не вдалося підготувати підсумок. Я вже зафіксував помилку. Спробуй ще раз трохи пізніше.";
}

function createReplySession(ctx: Context): ReplySession {
  return new ReplySession({
    draft:
      ctx.chat?.type === "private"
        ? createNativeDraftTransport(ctx)
        : undefined,
    send: async (text) => {
      await ctx.reply(text);
    },
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
}

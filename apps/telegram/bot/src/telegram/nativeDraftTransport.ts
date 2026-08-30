import { randomInt } from "node:crypto";
import { TelegramError, type Context } from "telegraf";
import type { ReplyTransport } from "../replySession.js";

const PEER_DRAFT_INTERVAL_MS = 800;
const peerQueues = new Map<number, Promise<void>>();
const lastPeerCallAt = new Map<number, number>();

type SendMessagePayload = {
  chat_id: number;
  text: string;
  message_thread_id?: number;
};

type DraftPayload = SendMessagePayload & { draft_id: number };

type DraftCapableTelegram = {
  callApi(method: "sendMessageDraft", payload: DraftPayload): Promise<unknown>;
  callApi(method: "sendMessage", payload: SendMessagePayload): Promise<unknown>;
};

export function createNativeDraftTransport(ctx: Context): ReplyTransport {
  const chat = ctx.chat;
  if (!chat || chat.type !== "private") {
    throw new Error("Native Telegram drafts require a private chat");
  }

  const draftId = randomInt(1, 2 ** 31);
  const threadId =
    ctx.message && "message_thread_id" in ctx.message
      ? ctx.message.message_thread_id
      : undefined;
  const telegram = ctx.telegram as unknown as DraftCapableTelegram;
  const thread = threadId === undefined ? {} : { message_thread_id: threadId };

  return {
    update: async (state) => {
      if (state.type === "complete") {
        await enqueuePeerCall(chat.id, async () => {
          await telegram.callApi("sendMessage", {
            chat_id: chat.id,
            text: state.text,
            ...thread,
          });
        });
        return;
      }

      await enqueuePeerCall(chat.id, async () => {
        await telegram.callApi("sendMessageDraft", {
          chat_id: chat.id,
          draft_id: draftId,
          text: state.text,
          ...thread,
        });
      });
    },
  };
}

async function enqueuePeerCall(
  chatId: number,
  send: () => Promise<void>,
): Promise<void> {
  const previous = peerQueues.get(chatId) ?? Promise.resolve();
  const current = previous
    .catch(() => undefined)
    .then(async () => {
      const remaining =
        PEER_DRAFT_INTERVAL_MS -
        (Date.now() - (lastPeerCallAt.get(chatId) ?? 0));
      if (remaining > 0) await delay(remaining);
      await sendWithFloodWaitRetry(chatId, send);
    });

  peerQueues.set(chatId, current);
  try {
    await current;
  } finally {
    if (peerQueues.get(chatId) === current) peerQueues.delete(chatId);
  }
}

async function sendWithFloodWaitRetry(
  chatId: number,
  send: () => Promise<void>,
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    lastPeerCallAt.set(chatId, Date.now());
    try {
      await send();
      return;
    } catch (error) {
      const retryAfter = getRetryAfterSeconds(error);
      if (retryAfter === undefined || attempt === 2) throw error;
      await delay(retryAfter * 1_000 + 100);
    }
  }
}

function getRetryAfterSeconds(error: unknown): number | undefined {
  if (!(error instanceof TelegramError) || error.code !== 429) return undefined;
  return error.parameters?.retry_after;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

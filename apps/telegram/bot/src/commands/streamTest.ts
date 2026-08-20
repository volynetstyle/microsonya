import { randomInt } from "node:crypto";
import { TelegramError, type Context } from "telegraf";
import { streamTextAsDraft } from "../telegram/draftStream.js";

const PEER_DRAFT_INTERVAL_MS = 800;
const draftQueues = new Map<number, Promise<void>>();
const lastDraftAt = new Map<number, number>();

const MOCK_RESPONSE = `Коротко: KoteNya розповіла, що в березні почала працювати програмістом 
   і досі отримує задоволення від розв’язання задач, порівнюючи це ремесло з створенням практичних речей. 
   Вона підкреслює переваги віддаленої роботи — свободу планування, можливість займатися домашніми справами 
   та економію часу на дорогу, а також зазначає, що програмування дозволяє їй поєднувати роботу з ілюстрацією 
   та підтримувати хороший work‑life balance. Окрім цього, KoteNya поділилася, що писала текст сама, а AI допоміг
   лише з пунктуацією та форматуванням. На противагу, Aliv R висловила незадоволення програмуванням, бо не відчуває 
   його корисності, часто «тідтує» і потребує «очищення» мозку після роботи, 
   проте вважає це своїм «харчуванням» і не уявляє іншу професію.`;

type SendMessagePayload = {
  chat_id: number;
  text: string;
  message_thread_id?: number;
};

type PlainDraftPayload = {
  chat_id: number;
  draft_id: number;
  text: string;
  message_thread_id?: number;
};

type DraftCapableTelegram = {
  callApi(
    method: "sendMessageDraft",
    payload: PlainDraftPayload,
  ): Promise<unknown>;
  callApi(method: "sendMessage", payload: SendMessagePayload): Promise<unknown>;
};

export async function runStreamTest(ctx: Context): Promise<void> {
  const chat = ctx.chat;
  if (!chat || chat.type !== "private") {
    await ctx.reply(
      "Тест live draft пока доступен только в личном чате с ботом.",
    );
    return;
  }

  const draftId = randomInt(1, 2 ** 31);
  const threadId =
    ctx.message && "message_thread_id" in ctx.message
      ? ctx.message.message_thread_id
      : undefined;
  const telegram = ctx.telegram as unknown as DraftCapableTelegram;

  await streamTextAsDraft(mockTextDeltas(MOCK_RESPONSE), {
    update: async (state) => {
      if (state.type === "complete") {
        await enqueuePeerCall(chat.id, async () => {
          await telegram.callApi("sendMessage", {
            chat_id: chat.id,
            text: state.text,
            ...(threadId === undefined ? {} : { message_thread_id: threadId }),
          });
        });
        return;
      }

      await enqueuePeerCall(chat.id, async () => {
        await telegram.callApi("sendMessageDraft", {
          chat_id: chat.id,
          draft_id: draftId,
          text: state.type === "thinking" ? "" : state.text,
          ...(threadId === undefined ? {} : { message_thread_id: threadId }),
        });
      });
    },
  });
}

async function enqueuePeerCall(
  chatId: number,
  send: () => Promise<void>,
): Promise<void> {
  const previous = draftQueues.get(chatId) ?? Promise.resolve();
  const current = previous
    .catch(() => undefined)
    .then(async () => {
      await waitForPeerSlot(chatId);
      await sendWithFloodWaitRetry(chatId, send);
    });

  draftQueues.set(chatId, current);
  try {
    await current;
  } finally {
    if (draftQueues.get(chatId) === current) draftQueues.delete(chatId);
  }
}

async function waitForPeerSlot(chatId: number): Promise<void> {
  const remaining =
    PEER_DRAFT_INTERVAL_MS - (Date.now() - (lastDraftAt.get(chatId) ?? 0));
  if (remaining > 0) await delay(remaining);
}

async function sendWithFloodWaitRetry(
  chatId: number,
  send: () => Promise<void>,
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    lastDraftAt.set(chatId, Date.now());
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

async function* mockTextDeltas(text: string): AsyncIterable<string> {
  const chunkSize = 18;
  for (let offset = 0; offset < text.length; offset += chunkSize) {
    yield text.slice(offset, offset + chunkSize);
    await delay(90);
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

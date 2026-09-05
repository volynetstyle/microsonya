import {
  TelegramEditableMessageTransport,
  TelegramPrivateDraftTransport,
  type TelegramApi,
} from "@microsonya/telegram";

const DEFAULT_RETRY_SECONDS = 30;

export class DeliveryError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    readonly retryAfterSeconds = DEFAULT_RETRY_SECONDS,
  ) {
    super(code);
    this.name = "DeliveryError";
  }
}

export async function sendTelegramMessage(
  token: string,
  chatId: string,
  text: string,
  messageThreadId?: number,
): Promise<number> {
  const response = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        ...(messageThreadId === undefined
          ? {}
          : { message_thread_id: messageThreadId }),
      }),
    },
  );
  const payload: unknown = await response.json();
  if (!response.ok)
    throw new DeliveryError(
      `TELEGRAM_HTTP_${response.status}`,
      response.status === 429 || response.status >= 500,
      telegramRetryAfter(payload),
    );
  const messageId = telegramMessageId(payload);
  if (messageId === undefined)
    throw new DeliveryError("TELEGRAM_MALFORMED_RESPONSE", true);
  return messageId;
}

export function createTelegramApi(token: string): TelegramApi {
  return { call: (method, body) => callTelegramApi(token, method, body) };
}

export function progressiveMessageId(
  transport: TelegramPrivateDraftTransport | TelegramEditableMessageTransport,
): number | undefined {
  return transport instanceof TelegramPrivateDraftTransport
    ? transport.messageId
    : transport.committedMessageId;
}

async function callTelegramApi(
  token: string,
  method: string,
  body: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  const response = await fetch(
    `https://api.telegram.org/bot${token}/${method}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  const payload: unknown = await response.json();
  if (!response.ok)
    throw new DeliveryError(
      `TELEGRAM_HTTP_${response.status}`,
      response.status === 429 || response.status >= 500,
      telegramRetryAfter(payload),
    );
  return payload;
}

function telegramMessageId(payload: unknown): number | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const result = (payload as { result?: unknown }).result;
  if (typeof result !== "object" || result === null) return undefined;
  const value = (result as { message_id?: unknown }).message_id;
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : undefined;
}

function telegramRetryAfter(payload: unknown): number {
  if (typeof payload !== "object" || payload === null)
    return DEFAULT_RETRY_SECONDS;
  const parameters = (payload as { parameters?: unknown }).parameters;
  if (typeof parameters !== "object" || parameters === null)
    return DEFAULT_RETRY_SECONDS;
  const value = (parameters as { retry_after?: unknown }).retry_after;
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : DEFAULT_RETRY_SECONDS;
}

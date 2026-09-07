import { type TelegramApi } from "@microsonya/telegram";

const DEFAULT_RETRY_SECONDS = 30;

export class DeliveryError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    readonly retryAfterSeconds = DEFAULT_RETRY_SECONDS,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = "DeliveryError";
  }
}

export async function sendTelegramMessage(
  token: string,
  chatId: string,
  text: string,
  messageThreadId?: number,
): Promise<number> {
  const payload = await callTelegramApi(token, "sendMessage", {
    chat_id: chatId,
    text,
    ...(messageThreadId === undefined
      ? {}
      : { message_thread_id: messageThreadId }),
  });
  const messageId = telegramMessageId(payload);
  if (messageId === undefined)
    throw new DeliveryError("TELEGRAM_MALFORMED_RESPONSE", true);
  return messageId;
}

export function createTelegramApi(token: string): TelegramApi {
  return { call: (method, body) => callTelegramApi(token, method, body) };
}

async function callTelegramApi(
  token: string,
  method: string,
  body: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (cause) {
    throw new DeliveryError(
      "TELEGRAM_NETWORK_ERROR",
      true,
      DEFAULT_RETRY_SECONDS,
      { cause },
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (cause) {
    throw new DeliveryError(
      response.ok
        ? "TELEGRAM_MALFORMED_RESPONSE"
        : `TELEGRAM_HTTP_${response.status}`,
      response.ok || isRetryableTelegramStatus(response.status),
      DEFAULT_RETRY_SECONDS,
      { cause },
    );
  }
  if (!response.ok || !isTelegramSuccess(payload)) {
    const status = telegramErrorCode(payload) ?? response.status;
    throw new DeliveryError(
      `TELEGRAM_HTTP_${status}`,
      isRetryableTelegramStatus(status),
      telegramRetryAfter(payload),
    );
  }
  return payload;
}

function isRetryableTelegramStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function isTelegramSuccess(payload: unknown): boolean {
  return (
    typeof payload === "object" &&
    payload !== null &&
    (payload as { readonly ok?: unknown }).ok === true
  );
}

function telegramErrorCode(payload: unknown): number | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const value = (payload as { readonly error_code?: unknown }).error_code;
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : undefined;
}

function telegramMessageId(payload: unknown): number | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const result = (payload as { result?: unknown }).result;
  if (typeof result !== "object" || result === null) return undefined;
  const value = (result as { message_id?: unknown }).message_id;
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
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

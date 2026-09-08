export function messageIdFrom(payload: unknown): number {
  if (typeof payload !== "object" || payload === null) {
    throw new TypeError("Telegram response has no message id.");
  }
  const result = (payload as { result?: unknown }).result;
  if (typeof result !== "object" || result === null) {
    throw new TypeError("Telegram response has no message id.");
  }
  const messageId = (result as { message_id?: unknown }).message_id;
  if (!Number.isSafeInteger(messageId)) {
    throw new TypeError("Telegram response has no message id.");
  }
  return messageId as number;
}

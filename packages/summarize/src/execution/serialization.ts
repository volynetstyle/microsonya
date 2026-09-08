import type { ChatId } from "@microsonya/shared";

export async function serializeByChat<T>(
  pendingByChat: Map<ChatId, Promise<void>>,
  chatId: ChatId,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = pendingByChat.get(chatId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  const tail = current.then(
    () => undefined,
    () => undefined,
  );
  pendingByChat.set(chatId, tail);
  try {
    return await current;
  } finally {
    if (pendingByChat.get(chatId) === tail) pendingByChat.delete(chatId);
  }
}

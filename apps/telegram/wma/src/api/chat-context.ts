import type { TelegramWebApp } from "./types";

/**
 * Returns the title of the chat whose context Telegram shared with the Mini
 * App. The `chat` object is only present for launch modes where Telegram is
 * allowed to expose it.
 *
 * @see https://core.telegram.org/bots/webapps#webappinitdata
 */
export function getTelegramChatTitle(
  webApp: TelegramWebApp | undefined,
): string | undefined {
  const title = webApp?.initDataUnsafe.chat?.title.trim();
  return title || undefined;
}

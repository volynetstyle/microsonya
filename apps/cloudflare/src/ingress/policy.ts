/** Whether replaying the same Telegram Bot API request may recover. */
export function isRetryableTelegramStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

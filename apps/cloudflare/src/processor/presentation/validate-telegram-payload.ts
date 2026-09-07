export const TELEGRAM_TEXT_MAX_LENGTH = 4_096;

/** Channel constraints do not decide semantic acceptance or consumption. */
export function validateTelegramPayload(text: string): string | undefined {
  if (text.trim().length === 0) return "SUMMARY_EMPTY";
  if (text.length > TELEGRAM_TEXT_MAX_LENGTH) return "SUMMARY_TOO_LONG";
  return undefined;
}

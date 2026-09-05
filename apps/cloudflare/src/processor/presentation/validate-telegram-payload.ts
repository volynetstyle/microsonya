/** Channel constraints do not decide semantic acceptance or consumption. */
export function validateTelegramPayload(text: string): string | undefined {
  if (text.trim().length === 0) return "SUMMARY_EMPTY";
  if (text.length > 4_096) return "SUMMARY_TOO_LONG";
  if (/\u0000/u.test(text)) return "SUMMARY_INVALID_ENCODING";
  return undefined;
}

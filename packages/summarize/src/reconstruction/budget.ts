const MIN_TOKENS = 2_048;
const MAX_TOKENS = 8_192;

export function reconstructionOutputTokenBudget(messageCount: number): number {
  const tokens = 512 + Math.max(0, Math.floor(messageCount)) * 320;
  return Math.min(MAX_TOKENS, Math.max(MIN_TOKENS, tokens));
}

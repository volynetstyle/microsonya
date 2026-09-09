export const EMPTY_SUMMARY_MESSAGE =
  "Немає нових повідомлень для підсумку." as const;

export function classifyUnknownFailure(error: unknown): {
  readonly code: string;
  readonly retryable: false;
  readonly retryAfterSeconds: 30;
} {
  return {
    code: error instanceof Error ? error.name : "UNKNOWN_ERROR",
    retryable: false,
    retryAfterSeconds: 30,
  };
}

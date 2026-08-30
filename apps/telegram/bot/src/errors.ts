import { OllamaError } from "@microsonya/model";

export function isModelRateLimitError(error: unknown): error is Error {
  return error instanceof OllamaError && error.status === 429;
}

export function formatRateLimitMessage(error: Error): string {
  const retryAfter = getRetryAfterSeconds(error.message);

  if (retryAfter) {
    return `Зараз модель обробляє занадто багато запитів. Спробуй ще раз приблизно через ${retryAfter} с.`;
  }

  return "Зараз модель обробляє занадто багато запитів. Спробуй ще раз трохи пізніше.";
}

function getRetryAfterSeconds(message: string): number | undefined {
  const match = message.match(/"retry_after_seconds"\s*:\s*(\d+)/);

  if (!match) {
    return undefined;
  }

  return Number(match[1]);
}

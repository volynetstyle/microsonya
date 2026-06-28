export function requiredConfigValue<T>(value: T | undefined, name: string): T {
  if (value === undefined) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

export function isModelRateLimitError(error: unknown): error is Error {
  return (
    error instanceof Error &&
    error.message.includes("Model request failed: 429")
  );
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

export function formatErrorForLog(error: unknown): string {
  if (!(error instanceof Error)) {
    return safeStringify(error);
  }

  return safeStringify({
    name: error.name,
    message: error.message,
    stack: error.stack,
    status: (error as { status?: unknown }).status,
    body: truncateString((error as { body?: unknown }).body),
  });
}

export function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncateString(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  return value.length > 2_000 ? `${value.slice(0, 2_000)}...` : value;
}

export function logModelStats(stats: unknown[]): void {
  if (stats.length === 0) {
    return;
  }

  try {
    console.table(stats);
  } catch {
    console.log("Model stats", safeStringify(stats));
  }
}
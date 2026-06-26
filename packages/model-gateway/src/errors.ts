export class ModelRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    readonly headers?: Record<string, string>,
  ) {
    super(`Model request failed: ${status} ${body}`);
    this.name = "ModelRequestError";
  }
}

export function parseRetryAfterMs(error: unknown): number | undefined {
  const anyError = error as {
    body?: string;
    headers?: Headers | Record<string, string>;
  };

  const fromHeader = readRetryAfterHeader(anyError.headers);

  if (fromHeader !== undefined) {
    return fromHeader;
  }

  if (typeof anyError.body !== "string") {
    return undefined;
  }

  try {
    const parsed = JSON.parse(anyError.body);
    const seconds =
      parsed?.error?.metadata?.retry_after_seconds ??
      parsed?.error?.metadata?.retry_after_seconds_raw ??
      parsed?.error?.metadata?.headers?.["Retry-After"];
    const value = Number(seconds);

    if (Number.isFinite(value) && value > 0) {
      return Math.ceil(value * 1000);
    }
  } catch {
    return undefined;
  }

  return undefined;
}

export function isRetryableModelError(error: unknown): boolean {
  const status = (error as { status?: number })?.status;

  return [408, 409, 425, 429, 500, 502, 503, 504, 529].includes(status ?? 0);
}

function readRetryAfterHeader(
  headers: Headers | Record<string, string> | undefined,
): number | undefined {
  if (!headers) {
    return undefined;
  }

  const raw =
    headers instanceof Headers
      ? (headers.get("Retry-After") ?? headers.get("retry-after"))
      : (headers["Retry-After"] ?? headers["retry-after"]);

  if (!raw) {
    return undefined;
  }

  const seconds = Number(raw);

  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.ceil(seconds * 1000);
  }

  const dateMs = Date.parse(raw);

  if (Number.isFinite(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }

  return undefined;
}

export type LaunchRetryOptions = {
  signal: AbortSignal;
  initialDelayMs?: number;
  maxDelayMs?: number;
  shouldRetry?: (error: unknown) => boolean;
  onRetry?: (error: unknown, delayMs: number) => void;
};

export async function launchWithRetry(
  launch: () => Promise<void>,
  options: LaunchRetryOptions,
): Promise<void> {
  const initialDelayMs = options.initialDelayMs ?? 1_000;
  const maxDelayMs = options.maxDelayMs ?? 30_000;
  let delayMs = initialDelayMs;

  while (!options.signal.aborted) {
    try {
      await launch();
      return;
    } catch (error) {
      if (options.signal.aborted) return;
      if (options.shouldRetry && !options.shouldRetry(error)) throw error;

      options.onRetry?.(error, delayMs);
      await abortableDelay(delayMs, options.signal);
      delayMs = Math.min(delayMs * 2, maxDelayMs);
    }
  }
}

function abortableDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }

    const timer = setTimeout(finish, delayMs);

    function finish() {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    }

    signal.addEventListener("abort", finish, { once: true });
  });
}

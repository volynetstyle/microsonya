export const DEFAULT_DRAFT_FLUSH_INTERVAL_MS = 800;
export const DEFAULT_DRAFT_MIN_NEW_CHARS = 12;

export type DraftState =
  | { type: "thinking" }
  | { type: "streaming"; text: string }
  | { type: "complete"; text: string };

export type DraftStreamTransport = {
  update(state: DraftState): Promise<void>;
};

export type DraftStreamOptions = {
  flushIntervalMs?: number;
  minNewChars?: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
};

/**
 * Reads model deltas without Telegram HTTP backpressure. A separate coalescing
 * flusher periodically sends only the latest accumulated snapshot. Every
 * non-empty draft is therefore a strict extension of the previous one, which
 * lets Telegram animate the newly appended characters natively.
 */
export async function streamTextAsDraft(
  deltas: AsyncIterable<string>,
  transport: DraftStreamTransport,
  options: DraftStreamOptions = {},
): Promise<string> {
  const flushIntervalMs =
    options.flushIntervalMs ?? DEFAULT_DRAFT_FLUSH_INTERVAL_MS;
  const minNewChars = options.minNewChars ?? DEFAULT_DRAFT_MIN_NEW_CHARS;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? delay;

  let text = "";
  let flushedLength = 0;
  let lastFlushAt = now();
  let producerDone = false;
  let producerError: unknown;
  let wakeFlusher: (() => void) | undefined;

  await transport.update({ type: "thinking" });
  lastFlushAt = now();

  const signalFlusher = () => {
    const wake = wakeFlusher;
    wakeFlusher = undefined;
    wake?.();
  };

  const waitForFlushCandidate = async (): Promise<void> => {
    if (producerDone || text.length - flushedLength >= minNewChars) return;
    await new Promise<void>((resolve) => {
      wakeFlusher = resolve;
    });
  };

  const producer = (async () => {
    try {
      for await (const delta of deltas) {
        if (delta.length === 0) continue;
        text += delta;
        if (text.length - flushedLength >= minNewChars) signalFlusher();
      }
    } catch (error) {
      producerError = error;
    } finally {
      producerDone = true;
      signalFlusher();
    }
  })();

  const flusher = (async () => {
    while (!producerDone || text.length > flushedLength) {
      await waitForFlushCandidate();
      if (producerDone && text.length === flushedLength) break;

      const remaining = flushIntervalMs - (now() - lastFlushAt);
      if (remaining > 0) await sleep(remaining);

      const snapshot = text;
      if (snapshot.length === flushedLength) continue;
      await transport.update({ type: "streaming", text: snapshot });
      flushedLength = snapshot.length;
      lastFlushAt = now();
    }
  })();

  await Promise.all([producer, flusher]);
  if (producerError !== undefined) throw producerError;

  await transport.update({ type: "complete", text });
  return text;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

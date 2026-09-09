export interface ConflatingWriterOptions<T> {
  /**
   * Delay before the next intermediate write.
   *
   * The first write is always immediate.
   */
  readonly delayMs: (lastWritten: T, pending: T) => number;

  readonly equals?: (left: T, right: T) => boolean;

  /** A slow successful write delays the next intermediate attempt. */
  readonly slowRequestThresholdMs?: number;
  readonly congestionCooldownMs?: number;

  /**
   * Intermediate writes are best-effort.
   * A failed intermediate update must not prevent the final commit.
   */
  readonly onIntermediateError?: (error: unknown) => void;

  readonly now?: () => number;
}

export class ConflatingWriter<T> {
  private pending?: T;
  private hasPending = false;

  private lastWritten?: T;
  private hasLastWritten = false;
  private lastWriteStartedAt = 0;
  private congestionCooldownUntil = 0;

  private inFlight?: Promise<void>;

  private timer?: ReturnType<typeof setTimeout>;
  private timerDueAt?: number;

  private finalizing = false;
  private closed = false;

  private readonly equals: (left: T, right: T) => boolean;
  private readonly now: () => number;

  constructor(
    private readonly write: (value: T) => Promise<void>,
    private readonly options: ConflatingWriterOptions<T>,
  ) {
    this.equals = options.equals ?? Object.is;
    this.now = options.now ?? Date.now;
  }

  /**
   * Latest intermediate value wins.
   *
   * This deliberately does not wait for the value to be physically written.
   */
  update(value: T): void {
    if (this.closed || this.finalizing) {
      throw new Error("Cannot update a finalized ConflatingWriter.");
    }

    this.pending = value;
    this.hasPending = true;

    this.schedule();
  }

  /**
   * Hard barrier:
   *
   * - drops obsolete pending snapshots;
   * - waits for an already running write;
   * - writes the authoritative final value;
   * - prevents subsequent updates.
   */
  async finalize(value: T): Promise<void> {
    if (this.closed) {
      if (this.hasLastWritten && this.equals(this.lastWritten as T, value)) {
        return;
      }

      throw new Error("ConflatingWriter is already finalized.");
    }

    if (this.finalizing) {
      throw new Error("ConflatingWriter is already finalizing.");
    }

    this.finalizing = true;

    this.cancelTimer();
    this.clearPending();

    try {
      if (this.inFlight !== undefined) {
        await this.inFlight;
      }

      if (this.hasLastWritten && this.equals(this.lastWritten as T, value)) {
        this.closed = true;
        return;
      }

      await this.write(value);
      this.recordWritten(value);

      this.closed = true;
    } catch (error) {
      // A failed final write may be followed by fail(), so restore the writer
      // to a state in which another terminal value can be attempted.
      this.finalizing = false;
      throw error;
    }

    this.finalizing = false;
  }

  private schedule(): void {
    if (
      this.closed ||
      this.finalizing ||
      this.inFlight !== undefined ||
      !this.hasPending
    ) {
      return;
    }

    const pending = this.pending as T;

    if (this.hasLastWritten && this.equals(this.lastWritten as T, pending)) {
      this.clearPending();
      this.cancelTimer();
      return;
    }

    // First visible write should appear immediately.
    if (!this.hasLastWritten) {
      this.cancelTimer();
      this.startWrite();
      return;
    }

    const delay = Math.max(
      0,
      this.options.delayMs(this.lastWritten as T, pending),
    );

    // Crucially this is anchored to the previous write, not to the latest
    // update. A stream of tiny updates therefore cannot postpone a flush
    // forever.
    const dueAt = Math.max(
      this.lastWriteStartedAt + delay,
      this.congestionCooldownUntil,
    );
    const waitMs = Math.max(0, dueAt - this.now());

    if (waitMs === 0) {
      this.cancelTimer();
      this.startWrite();
      return;
    }

    // Backlog may pull a flush forward, but a later update must never
    // postpone an already promised flush.
    if (this.timerDueAt !== undefined && this.timerDueAt <= dueAt) {
      return;
    }

    this.cancelTimer();

    this.timerDueAt = dueAt;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.timerDueAt = undefined;
      this.startWrite();
    }, waitMs);
  }

  private startWrite(): void {
    if (
      this.closed ||
      this.finalizing ||
      this.inFlight !== undefined ||
      !this.hasPending
    ) {
      return;
    }

    const value = this.pending as T;
    this.clearPending();

    if (this.hasLastWritten && this.equals(this.lastWritten as T, value)) {
      this.schedule();
      return;
    }

    const operation = (async () => {
      try {
        // Cadence is measured between physical request starts. Telegram RTT
        // therefore consumes the interval instead of being added to it.
        const startedAt = this.now();
        this.lastWriteStartedAt = startedAt;
        await this.write(value);
        const completedAt = this.now();
        this.recordWritten(value);

        if (
          this.options.slowRequestThresholdMs !== undefined &&
          this.options.congestionCooldownMs !== undefined &&
          completedAt - startedAt >= this.options.slowRequestThresholdMs
        ) {
          this.congestionCooldownUntil =
            completedAt + this.options.congestionCooldownMs;
        }
      } catch (error) {
        // Progressive states are disposable. A failed intermediate edit
        // must not poison the authoritative final commit.
        try {
          this.options.onIntermediateError?.(error);
        } catch {
          // Telemetry/logging is not allowed to break the writer.
        }
      }
    })();

    this.inFlight = operation.finally(() => {
      this.inFlight = undefined;

      // Anything accumulated while the HTTP request was in flight is now
      // reconsidered as one latest snapshot.
      this.schedule();
    });
  }

  private recordWritten(value: T): void {
    this.lastWritten = value;
    this.hasLastWritten = true;
  }

  private clearPending(): void {
    this.pending = undefined;
    this.hasPending = false;
  }

  private cancelTimer(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }

    this.timerDueAt = undefined;
  }
}

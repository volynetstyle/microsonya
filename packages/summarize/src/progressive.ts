export type ProgressiveState =
  | "idle"
  | "preparing"
  | "streaming"
  | "finalizing"
  | "completed"
  | "failed";

export type SummaryStreamEvent =
  | { readonly type: "delta"; readonly text: string }
  | { readonly type: "done" };

export interface SummaryStream {
  readonly chunks: AsyncIterable<string>;
}

export interface ProgressiveTransport {
  begin(): Promise<void>;
  update(text: string): Promise<void>;
  commit(text: string): Promise<void>;
  fail(): Promise<void>;
}

export interface ProgressiveCadencePolicy {
  readonly firstMaxWaitMs: number;
  readonly firstMinChars: number;
  readonly minIntervalMs: number;
  readonly minDeltaChars: number;
  readonly maxStalenessMs: number;
}

export const PRIVATE_PROGRESSIVE_POLICY: ProgressiveCadencePolicy =
  Object.freeze({
    firstMaxWaitMs: 300,
    firstMinChars: 20,
    minIntervalMs: 900,
    minDeltaChars: 24,
    maxStalenessMs: 1_800,
  });

export const GROUP_PROGRESSIVE_POLICY: ProgressiveCadencePolicy = Object.freeze(
  {
    firstMaxWaitMs: 400,
    firstMinChars: 24,
    minIntervalMs: 1_100,
    minDeltaChars: 32,
    maxStalenessMs: 2_000,
  },
);

export class ProgressiveOutputInvariantError extends Error {
  constructor() {
    super("Progressive output must be append-only.");
    this.name = "ProgressiveOutputInvariantError";
  }
}

/** Serializes transport calls and coalesces snapshots produced while one is in flight. */
export class SerializedPublisher {
  private desired = "";
  private published = "";
  private draining?: Promise<void>;
  private terminal = false;

  constructor(private readonly transport: ProgressiveTransport) {}

  set(text: string): void {
    if (this.terminal) throw new Error("Progressive publisher is terminal.");
    assertAppendOnly(this.desired, text);
    this.desired = text;
    this.startDrain();
  }

  async flush(): Promise<void> {
    this.startDrain();
    await this.draining;
  }

  async commit(finalText: string): Promise<void> {
    if (this.terminal) return;
    assertAppendOnly(this.desired, finalText);
    this.desired = finalText;
    await this.flush();
    this.terminal = true;
    await this.transport.commit(finalText);
  }

  async fail(): Promise<void> {
    if (this.terminal) return;
    this.terminal = true;
    await this.draining;
    await this.transport.fail();
  }

  private startDrain(): void {
    if (this.draining || this.desired === this.published) return;
    this.draining = this.drain().finally(() => {
      this.draining = undefined;
      if (!this.terminal && this.desired !== this.published) this.startDrain();
    });
  }

  private async drain(): Promise<void> {
    while (!this.terminal && this.desired !== this.published) {
      const snapshot = this.desired;
      assertAppendOnly(this.published, snapshot);
      await this.transport.update(snapshot);
      this.published = snapshot;
    }
  }
}

export class ProgressiveScheduler {
  private latest = "";
  private publishedLength = 0;
  private firstAppendAt?: number;
  private lastPublishAt?: number;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly policy: ProgressiveCadencePolicy,
    private readonly publish: (snapshot: string) => void,
    private readonly now: () => number = () => Date.now(),
  ) {}

  notify(text: string): void {
    assertAppendOnly(this.latest, text);
    this.latest = text;
    const now = this.now();
    this.firstAppendAt ??= now;
    if (this.shouldFlush(now)) this.flush();
    else this.arm();
  }

  flushNow(text = this.latest): void {
    assertAppendOnly(this.latest, text);
    this.latest = text;
    this.flush();
  }

  cancel(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private shouldFlush(now: number): boolean {
    const unpublished = this.latest.length - this.publishedLength;
    if (this.lastPublishAt === undefined) {
      return (
        unpublished >= this.policy.firstMinChars ||
        now - this.firstAppendAt! >= this.policy.firstMaxWaitMs
      );
    }
    const elapsed = now - this.lastPublishAt;
    return (
      (elapsed >= this.policy.minIntervalMs &&
        unpublished >= this.policy.minDeltaChars) ||
      elapsed >= this.policy.maxStalenessMs
    );
  }

  private arm(): void {
    if (this.timer !== undefined) return;
    const base = this.lastPublishAt ?? this.firstAppendAt ?? this.now();
    const wait =
      this.lastPublishAt === undefined
        ? this.policy.firstMaxWaitMs
        : this.policy.maxStalenessMs;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (this.latest.length > this.publishedLength) this.flush();
    }, Math.max(0, base + wait - this.now()));
  }

  private flush(): void {
    this.cancel();
    if (this.latest.length === this.publishedLength) return;
    this.publish(this.latest);
    this.publishedLength = this.latest.length;
    this.lastPublishAt = this.now();
  }
}

export class ProgressiveSummarySession {
  private text = "";
  private stateValue: ProgressiveState = "idle";
  private readonly scheduler: ProgressiveScheduler;

  constructor(
    private readonly transport: ProgressiveTransport,
    private readonly publisher = new SerializedPublisher(transport),
    policy: ProgressiveCadencePolicy = GROUP_PROGRESSIVE_POLICY,
    now?: () => number,
  ) {
    this.scheduler = new ProgressiveScheduler(
      policy,
      (snapshot) => this.publisher.set(snapshot),
      now,
    );
  }

  get state(): ProgressiveState {
    return this.stateValue;
  }

  async begin(): Promise<void> {
    if (this.stateValue !== "idle") return;
    this.stateValue = "preparing";
    try {
      await this.transport.begin();
      this.stateValue = "streaming";
    } catch (error) {
      this.stateValue = "failed";
      throw error;
    }
  }

  append(delta: string): void {
    if (this.stateValue !== "streaming") {
      throw new Error("Progressive session is not streaming.");
    }
    if (delta.length === 0) return;
    this.text += delta;
    this.scheduler.notify(this.text);
  }

  async complete(): Promise<string> {
    if (this.stateValue === "completed") return this.text;
    await this.finalize();
    return this.commit();
  }

  /** Flushes the final preview, but deliberately does not perform final delivery. */
  async finalize(): Promise<string> {
    if (this.stateValue === "finalizing" || this.stateValue === "completed") {
      return this.text;
    }
    if (this.stateValue !== "streaming") throw new Error("Progressive session cannot be finalized.");
    this.stateValue = "finalizing";
    this.scheduler.flushNow(this.text);
    try {
      await this.publisher.flush();
      return this.text;
    } catch (error) {
      this.stateValue = "failed";
      throw error;
    }
  }

  /** Commits only after the caller has durably saved the canonical summary. */
  async commit(): Promise<string> {
    if (this.stateValue === "completed") return this.text;
    if (this.stateValue !== "finalizing") throw new Error("Progressive session is not finalized.");
    try {
      await this.publisher.commit(this.text);
      this.stateValue = "completed";
      return this.text;
    } catch (error) {
      this.stateValue = "failed";
      throw error;
    }
  }

  async fail(_error?: unknown): Promise<void> {
    if (this.stateValue === "completed" || this.stateValue === "failed") return;
    this.scheduler.cancel();
    this.stateValue = "failed";
    await this.publisher.fail();
  }
}

export async function streamSummaryRun(
  stream: SummaryStream | AsyncIterable<string>,
  session: ProgressiveSummarySession,
  signal?: AbortSignal,
): Promise<string> {
  await session.begin();
  try {
    const chunks = Symbol.asyncIterator in stream ? stream : stream.chunks;
    for await (const delta of chunks) {
      signal?.throwIfAborted();
      session.append(delta);
    }
    signal?.throwIfAborted();
    return await session.complete();
  } catch (error) {
    await session.fail(error);
    throw error;
  }
}

function assertAppendOnly(previous: string, next: string): void {
  if (!next.startsWith(previous)) throw new ProgressiveOutputInvariantError();
}

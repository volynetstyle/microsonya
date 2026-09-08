import { assertAppendOnly } from "./append-only.js";
import type { ProgressiveCadencePolicy } from "./cadence.js";

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
    this.timer = setTimeout(
      () => {
        this.timer = undefined;
        if (this.latest.length > this.publishedLength) this.flush();
      },
      Math.max(0, base + wait - this.now()),
    );
  }

  private flush(): void {
    this.cancel();
    if (this.latest.length === this.publishedLength) return;
    this.publish(this.latest);
    this.publishedLength = this.latest.length;
    this.lastPublishAt = this.now();
  }
}

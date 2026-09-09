import type { ProgressiveCadencePolicy } from "./cadence.js";
import { GROUP_PROGRESSIVE_POLICY } from "./cadence.js";
import { ProgressiveScheduler } from "./ProgressiveScheduler.js";
import { SerializedPublisher } from "./SerializedPublisher.js";
import type { ProgressiveState } from "./state.js";
import type { ProgressiveTransport } from "./transport.js";

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
    if (this.stateValue !== "streaming")
      throw new Error("Progressive session cannot be finalized.");
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
    if (this.stateValue !== "finalizing")
      throw new Error("Progressive session is not finalized.");
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

  /** Cancels presentation for a retry without emitting a failure payload. */
  async abort(): Promise<void> {
    if (this.stateValue === "completed" || this.stateValue === "failed") return;
    this.scheduler.cancel();
    this.stateValue = "failed";
    await this.publisher.abort();
  }
}

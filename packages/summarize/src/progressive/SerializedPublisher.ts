import { assertAppendOnly } from "./append-only.js";
import type { ProgressiveTransport } from "./transport.js";

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

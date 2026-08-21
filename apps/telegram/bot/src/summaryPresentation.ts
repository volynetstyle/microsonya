import type { DraftStreamTransport } from "./telegram/draftStream.js";

export type SummaryPresentationOptions = {
  thinkingDelayMs?: number;
};

type SessionState = "idle" | "armed" | "thinking" | "streaming" | "settled";

export class SummaryPresentationSession {
  private state: SessionState = "idle";
  private thinkingTimer?: ReturnType<typeof setTimeout>;
  private thinkingStart: Promise<void> = Promise.resolve();
  private transportAvailable: boolean;
  private thinkingText?: string;

  constructor(
    private readonly transport: DraftStreamTransport | undefined,
    private readonly fallback: (text: string) => Promise<void>,
    private readonly options: SummaryPresentationOptions = {},
  ) {
    this.transportAvailable = transport !== undefined;
  }

  arm(): void {
    if (this.state !== "idle") return;
    this.state = "armed";
    const transport = this.transport;
    if (!transport) return;

    this.thinkingTimer = setTimeout(() => {
      this.thinkingTimer = undefined;
      if (this.state !== "armed") return;
      this.state = "thinking";
      this.thinkingStart = transport
        .update(
          this.thinkingText === undefined
            ? { type: "thinking" }
            : { type: "thinking", text: this.thinkingText },
        )
        .catch(() => {
          this.transportAvailable = false;
        });
    }, this.options.thinkingDelayMs ??  50);
  }

  async status(text: string): Promise<void> {
    if (this.state === "settled" || text.length === 0) return;
    this.thinkingText = text;
    if (this.state === "idle") this.arm();
    if (this.state === "armed") return;
    await this.thinkingStart;
    if (
      this.state !== "thinking" ||
      !this.transport ||
      !this.transportAvailable
    ) {
      return;
    }
    try {
      await this.transport.update({ type: "thinking", text });
    } catch {
      this.transportAvailable = false;
    }
  }

  async snapshot(text: string): Promise<void> {
    if (this.state === "settled" || text.length === 0) return;
    this.clearThinkingTimer();
    await this.thinkingStart;
    if (!this.transport || !this.transportAvailable) return;

    try {
      await this.transport.update({ type: "streaming", text });
      this.state = "streaming";
    } catch {
      this.transportAvailable = false;
    }
  }

  complete(text: string): Promise<void> {
    return this.settle(text);
  }

  fail(text: string): Promise<void> {
    return this.settle(text);
  }

  private async settle(text: string): Promise<void> {
    if (this.state === "settled") return;
    this.state = "settled";
    this.clearThinkingTimer();
    await this.thinkingStart;

    if (this.transport && this.transportAvailable) {
      try {
        await this.transport.update({ type: "complete", text });
        return;
      } catch {
        this.transportAvailable = false;
      }
    }

    await this.fallback(text);
  }

  private clearThinkingTimer(): void {
    if (this.thinkingTimer) clearTimeout(this.thinkingTimer);
    this.thinkingTimer = undefined;
  }
}

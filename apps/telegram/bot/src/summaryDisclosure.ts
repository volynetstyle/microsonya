import type { SummaryWaterfallEvent } from "@microsonya/summarize";

export type DisclosureThresholds = {
  typingMs: number;
  statusMs: number;
  detailMs: number;
  cancelMs: number;
};

export const DEFAULT_DISCLOSURE_THRESHOLDS: DisclosureThresholds = {
  typingMs: 1_000,
  statusMs: 3_000,
  detailMs: 10_000,
  cancelMs: 20_000,
};

export type DisclosureTransport = {
  sendTyping(): Promise<void>;
  sendStatus(text: string, cancellable: boolean): Promise<number>;
  editStatus(
    messageId: number,
    text: string,
    cancellable: boolean,
  ): Promise<void>;
  sendFinal(text: string): Promise<void>;
};

type KnownWork = {
  messageCount?: number;
  segmentCount?: number;
  completedSegments?: number;
  stage: "analyzing" | "segments" | "summary";
};

export class LatencyAwareDisclosure {
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private typingInterval?: ReturnType<typeof setInterval>;
  private statusMessageId?: number;
  private statusPromise?: Promise<void>;
  private editQueue = Promise.resolve();
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private lastStatusText?: string;
  private lastStatusCancellable?: boolean;
  private settled = false;
  private detailsEnabled = false;
  private cancellable = false;
  private work: KnownWork = { stage: "analyzing" };

  constructor(
    private readonly transport: DisclosureTransport,
    private readonly thresholds = DEFAULT_DISCLOSURE_THRESHOLDS,
  ) {}

  start(): void {
    this.schedule(this.thresholds.typingMs, () => this.startTyping());
    this.schedule(this.thresholds.statusMs, () => this.showStatus());
    this.schedule(this.thresholds.detailMs, () => {
      this.detailsEnabled = true;
      this.refreshStatus();
    });
    this.schedule(this.thresholds.cancelMs, () => {
      this.cancellable = true;
      this.refreshStatus();
    });
  }

  onTrace(event: SummaryWaterfallEvent): void {
    if (event.stage === "segments.planned") {
      this.work = {
        ...this.work,
        stage: "segments",
        messageCount: event.messageCount,
        segmentCount: event.segmentCount,
      };
    } else if (event.stage === "segment.model") {
      this.work.stage = "summary";
    } else if (event.stage === "segment.complete") {
      this.work.stage = "summary";
      this.work.completedSegments = event.completedSegments;
      this.work.segmentCount = event.segmentCount ?? this.work.segmentCount;
    }

    if (this.detailsEnabled) this.scheduleRefresh();
  }

  async finish(finalText: string): Promise<void> {
    this.settled = true;
    this.clearTimers();
    await this.statusPromise;
    await this.editQueue;
    if (this.statusMessageId === undefined) {
      await this.transport.sendFinal(finalText);
      return;
    }
    try {
      await this.transport.editStatus(this.statusMessageId, finalText, false);
    } catch {
      await this.transport.sendFinal(finalText);
    }
  }

  cancelling(): void {
    if (this.statusMessageId === undefined) return;
    this.queueEdit("⏳ Скасовую…", false);
  }

  async fail(text: string): Promise<boolean> {
    this.settled = true;
    this.clearTimers();
    await this.statusPromise;
    await this.editQueue;
    if (this.statusMessageId === undefined) return false;
    await this.transport.editStatus(this.statusMessageId, text, false);
    return true;
  }

  private schedule(delayMs: number, run: () => void): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (!this.settled) run();
    }, delayMs);
    this.timers.add(timer);
  }

  private startTyping(): void {
    void this.transport.sendTyping().catch(() => undefined);
    this.typingInterval = setInterval(() => {
      void this.transport.sendTyping().catch(() => undefined);
    }, 4_000);
  }

  private showStatus(): void {
    this.stopTyping();
    if (this.statusPromise || this.settled) return;
    const text = this.renderStatus();
    const cancellable = this.cancellable;
    this.statusPromise = this.transport
      .sendStatus(text, cancellable)
      .then((messageId) => {
        this.statusMessageId = messageId;
        this.lastStatusText = text;
        this.lastStatusCancellable = cancellable;
        this.refreshStatus();
      })
      .catch(() => undefined);
  }

  private refreshStatus(): void {
    if (this.statusMessageId === undefined) return;
    const text = this.renderStatus();
    if (
      text === this.lastStatusText &&
      this.cancellable === this.lastStatusCancellable
    ) {
      return;
    }
    this.lastStatusText = text;
    this.lastStatusCancellable = this.cancellable;
    this.queueEdit(text, this.cancellable);
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer || this.settled) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      this.refreshStatus();
    }, 750);
  }

  private queueEdit(text: string, cancellable: boolean): void {
    const messageId = this.statusMessageId;
    if (messageId === undefined || this.settled) return;
    this.editQueue = this.editQueue
      .catch(() => undefined)
      .then(() => this.transport.editStatus(messageId, text, cancellable))
      .catch(() => undefined);
  }

  private renderStatus(): string {
    const scale = renderScale(this.work);
    if (!this.detailsEnabled) {
      return ["⏳ Аналізую чат", scale].filter(Boolean).join("\n");
    }

    const label =
      this.work.stage === "summary"
        ? "⏳ Формую підсумок"
        : this.work.stage === "segments"
          ? "⏳ Обробляю сегменти"
          : "⏳ Аналізую чат";
    return [label, scale].filter(Boolean).join("\n");
  }

  private clearTimers(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = undefined;
    this.stopTyping();
  }

  private stopTyping(): void {
    if (this.typingInterval) clearInterval(this.typingInterval);
    this.typingInterval = undefined;
  }
}

function renderScale(work: KnownWork): string {
  const parts: string[] = [];
  if (work.messageCount !== undefined) {
    parts.push(`${work.messageCount} повідомлень`);
  }
  if (work.segmentCount !== undefined) {
    const progress =
      work.completedSegments !== undefined
        ? `${work.completedSegments}/${work.segmentCount} сегментів`
        : `${work.segmentCount} сегментів`;
    parts.push(progress);
  }
  return parts.join(" · ");
}

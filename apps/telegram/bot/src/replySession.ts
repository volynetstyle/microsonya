export type ReplyUpdate =
  | { readonly type: "progress"; readonly text: string }
  | { readonly type: "complete"; readonly text: string };

export interface ReplyTransport {
  update(state: ReplyUpdate): Promise<void>;
}

export interface ReplySessionOptions {
  readonly draft?: ReplyTransport;
  readonly send: (text: string) => Promise<void>;
  readonly progressDelayMs?: number;
}

/** Sends delayed draft progress and exactly one final response with fallback. */
export class ReplySession {
  private settled = false;
  private progressVisible = false;
  private progressTimer?: ReturnType<typeof setTimeout>;
  private latestProgressText?: string;
  private draftAvailable: boolean;
  private draftQueue: Promise<void> = Promise.resolve();

  constructor(private readonly options: ReplySessionOptions) {
    this.draftAvailable = options.draft !== undefined;
  }

  async progress(text: string): Promise<void> {
    if (text.length === 0 || this.settled) return;

    this.latestProgressText = text;
    if (this.progressVisible) {
      await this.pushDraft({ type: "progress", text });
      return;
    }
    if (this.progressTimer !== undefined || !this.options.draft) return;

    this.progressTimer = setTimeout(() => {
      this.progressTimer = undefined;
      if (this.settled || !this.latestProgressText) return;
      this.progressVisible = true;
      void this.pushDraft({
        type: "progress",
        text: this.latestProgressText,
      });
    }, this.options.progressDelayMs ?? 50);
  }

  async finish(text: string): Promise<void> {
    if (this.settled) return;
    this.settled = true;
    this.clearProgressTimer();

    const delivered = await this.pushDraft({ type: "complete", text });
    if (!delivered) await this.options.send(text);
  }

  private pushDraft(update: ReplyUpdate): Promise<boolean> {
    const operation = this.draftQueue.then(async () => {
      const draft = this.options.draft;
      if (!draft || !this.draftAvailable) return false;
      try {
        await draft.update(update);
        return true;
      } catch {
        this.draftAvailable = false;
        return false;
      }
    });
    this.draftQueue = operation.then(() => undefined);
    return operation;
  }

  private clearProgressTimer(): void {
    if (this.progressTimer !== undefined) {
      clearTimeout(this.progressTimer);
      this.progressTimer = undefined;
    }
  }
}

export type SummaryWaterfallEvent = {
  traceId: string;
  chatId: string;
  commandMessageId: number;
  stage: string;
  status: "ok" | "error";
  offsetMs: number;
  durationMs: number;
  segmentId?: string;
  memoryBatch?: number;
  cacheStatus?: "hit" | "miss";
  messageCount?: number;
  segmentCount?: number;
  completedSegments?: number;
  promptChars?: number;
  fromMessageId?: number;
  toMessageId?: number;
  watermarkBefore?: number | null;
  error?: string;
};

export type SummaryWaterfallSink = (event: SummaryWaterfallEvent) => void;

export class SummaryWaterfall {
  private readonly startedAt = performance.now();
  readonly traceId: string;

  constructor(
    private readonly chatId: string,
    private readonly commandMessageId: number,
    private readonly sink: SummaryWaterfallSink = defaultSink,
  ) {
    this.traceId = `${chatId}:${commandMessageId}`;
  }

  async span<T>(
    stage: string,
    details: Omit<
      Partial<SummaryWaterfallEvent>,
      | "traceId"
      | "chatId"
      | "commandMessageId"
      | "stage"
      | "status"
      | "offsetMs"
      | "durationMs"
      | "error"
    >,
    run: () => Promise<T> | T,
  ): Promise<T> {
    const offsetMs = performance.now() - this.startedAt;
    const startedAt = performance.now();
    try {
      const result = await run();
      this.emit({
        stage,
        status: "ok",
        offsetMs,
        durationMs: performance.now() - startedAt,
        ...details,
      });
      return result;
    } catch (error) {
      this.emit({
        stage,
        status: "error",
        offsetMs,
        durationMs: performance.now() - startedAt,
        ...details,
        ...(error instanceof Error ? { error: error.message } : {}),
      });
      throw error;
    }
  }

  event(
    stage: string,
    details: Omit<
      Partial<SummaryWaterfallEvent>,
      | "traceId"
      | "chatId"
      | "commandMessageId"
      | "stage"
      | "status"
      | "offsetMs"
      | "durationMs"
    > = {},
  ): void {
    this.emit({
      stage,
      status: details.error ? "error" : "ok",
      offsetMs: performance.now() - this.startedAt,
      durationMs: 0,
      ...details,
    });
  }

  private emit(
    event: Omit<
      SummaryWaterfallEvent,
      "traceId" | "chatId" | "commandMessageId"
    >,
  ): void {
    this.sink({
      traceId: this.traceId,
      chatId: this.chatId,
      commandMessageId: this.commandMessageId,
      ...event,
    });
  }
}

function defaultSink(event: SummaryWaterfallEvent): void {
  console.info("Summary waterfall", JSON.stringify(event));
}

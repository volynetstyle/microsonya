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
  episodeCount?: number;
  completedSegments?: number;
  segmentIndex?: number;
  promptChars?: number;
  fromMessageId?: number;
  toMessageId?: number;
  watermarkBefore?: number | null;
  error?: string;
};

export type SummaryWaterfallSink = (event: SummaryWaterfallEvent) => void;

export type SummarizationEvent =
  | {
      type: "segment-started";
      segmentId: string;
      index: number;
      total: number;
    }
  | {
      type: "segment-completed";
      segmentId: string;
      completed: number;
      total: number;
    }
  | { type: "render-started" }
  | { type: "summary-completed" };

export interface SummaryObserver {
  emit(event: SummarizationEvent): void | Promise<void>;
}

export class SummaryWaterfall {
  private readonly startedAt = performance.now();
  readonly traceId: string;

  constructor(
    private readonly chatId: string,
    private readonly commandMessageId: number,
    private readonly sink: SummaryWaterfallSink = defaultSink,
    private readonly observer?: SummaryObserver,
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
    if (stage === "summary.model") {
      this.emitObserved({ type: "render-started" });
    }
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
    const completeEvent = {
      traceId: this.traceId,
      chatId: this.chatId,
      commandMessageId: this.commandMessageId,
      ...event,
    };
    this.sink(completeEvent);

    const observed = toSummarizationEvent(completeEvent);
    if (observed) this.emitObserved(observed);
  }

  private emitObserved(event: SummarizationEvent): void {
    try {
      const result = this.observer?.emit(event);
      if (result) void result.catch(reportObserverError);
    } catch (error) {
      reportObserverError(error);
    }
  }
}

function toSummarizationEvent(
  event: SummaryWaterfallEvent,
): SummarizationEvent | undefined {
  if (
    event.stage === "segment.started" &&
    event.segmentId !== undefined &&
    event.segmentIndex !== undefined &&
    event.segmentCount !== undefined
  ) {
    return {
      type: "segment-started",
      segmentId: event.segmentId,
      index: event.segmentIndex,
      total: event.segmentCount,
    };
  }
  if (
    event.stage === "segment.complete" &&
    event.segmentId !== undefined &&
    event.completedSegments !== undefined &&
    event.segmentCount !== undefined
  ) {
    return {
      type: "segment-completed",
      segmentId: event.segmentId,
      completed: event.completedSegments,
      total: event.segmentCount,
    };
  }
  if (event.stage === "summary.complete") {
    return { type: "summary-completed" };
  }
  return undefined;
}

function reportObserverError(error: unknown): void {
  console.warn(
    "Summary observer failed",
    error instanceof Error ? error.message : String(error),
  );
}

function defaultSink(event: SummaryWaterfallEvent): void {
  console.info("Summary waterfall", JSON.stringify(event));
}

import type { SummaryWaterfallEvent } from "./waterfall.js";

export type SummarizationTelemetrySink = (
  event: SummaryWaterfallEvent,
) => void;

/** Application-facing telemetry boundary for the summarization pipeline. */
export class SummarizationTelemetryService {
  constructor(
    private readonly sink: SummarizationTelemetrySink = logTelemetry,
  ) {}

  record(event: SummaryWaterfallEvent): void {
    this.sink(event);
  }
}

function logTelemetry(event: SummaryWaterfallEvent): void {
  console.info("Summarization telemetry", JSON.stringify(event));
}

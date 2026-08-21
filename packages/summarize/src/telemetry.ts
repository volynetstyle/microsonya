export type SummarizationTelemetryEvent = {
  chatId: string;
  commandMessageId: number;
  messageCount?: number;
  durationMs: number;
  status: "ok" | "error";
  error?: string;
};

export class SummarizationTelemetryService {
  constructor(
    private readonly sink: (event: SummarizationTelemetryEvent) => void = log,
  ) {}
  record(event: SummarizationTelemetryEvent): void {
    this.sink(event);
  }
}

function log(event: SummarizationTelemetryEvent): void {
  console.info("Summarization telemetry", JSON.stringify(event));
}

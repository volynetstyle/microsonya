import type { SummaryExecutionEvent } from "./events.js";
import type {
  SummaryExecutionContext,
  SummaryExecutionRecorder,
} from "./observer.js";

type SummarizationTelemetryContext = SummaryExecutionContext;

export type SummarizationTelemetryEvent = SummarizationTelemetryContext &
  SummaryExecutionEvent & {
    offsetMs: number;
  };

export type SummarizationTelemetryOptions = {
  includePrompt?: boolean;
  includeModelResponse?: boolean;
};

export class SummarizationTelemetryService {
  constructor(
    private readonly sink:
      | ((event: SummarizationTelemetryEvent) => void)
      | null = process.env.NODE_ENV === "production" ? null : log,
    private readonly options: SummarizationTelemetryOptions = {
      includePrompt: process.env.SUMMARIZATION_LOG_PROMPT === "1",
      includeModelResponse:
        process.env.NODE_ENV === "development" ||
        process.env.SUMMARIZATION_LOG_MODEL_RESPONSE === "1",
    },
  ) {}

  start(context: SummarizationTelemetryContext): SummarizationTelemetryTrace {
    return new SummarizationTelemetryTrace(context, this.sink, this.options);
  }
}

export class SummarizationTelemetryTrace implements SummaryExecutionRecorder {
  readonly emitsEvents: boolean;
  private readonly startedAt: number;

  constructor(
    private readonly context: SummarizationTelemetryContext,
    private readonly sink:
      | ((event: SummarizationTelemetryEvent) => void)
      | null,
    private readonly options: SummarizationTelemetryOptions,
  ) {
    this.emitsEvents = sink !== null;
    this.startedAt = this.emitsEvents ? performance.now() : 0;
  }

  record(payload: SummaryExecutionEvent): void {
    if (this.sink === null) return;
    if (payload.type === "model.request" && !this.options.includePrompt) {
      const { prompt: _, ...withoutPrompt } = payload;

      this.emit(withoutPrompt);
      return;
    }

    if (
      payload.type === "model.response.raw" &&
      !this.options.includeModelResponse
    ) {
      const { response: _, ...withoutResponse } = payload;
      this.emit(withoutResponse);
      return;
    }

    if (
      payload.type === "model.response.envelope" &&
      !this.options.includeModelResponse
    ) {
      const { content: _, thinking: __, ...withoutModelText } = payload;
      this.emit(withoutModelText);
      return;
    }

    this.emit(payload);
  }

  private emit(payload: SummaryExecutionEvent): void {
    if (this.sink === null) return;
    try {
      this.sink({
        ...this.context,
        ...payload,
        offsetMs: performance.now() - this.startedAt,
      });
    } catch {
      // Telemetry is auxiliary. A sink owned by an adapter or test harness
      // must never break classification, generation, persistence, or the
      // evidence ledger.
    }
  }
}

function log(event: SummarizationTelemetryEvent): void {
  const prompt = event.type === "model.request" ? event.prompt : undefined;
  const response =
    event.type === "model.response.raw" ? event.response : undefined;
  const envelopeContent =
    event.type === "model.response.envelope" ? event.content : undefined;
  const envelopeThinking =
    event.type === "model.response.envelope" ? event.thinking : undefined;
  const metadata = {
    ...event,
    prompt: undefined,
    response: undefined,
    content: undefined,
    thinking: undefined,
  };

  console.info(
    `[summarization:${event.type}]`,
    JSON.stringify(metadata, null, 2),
  );

  if (event.type === "model.request" && prompt !== undefined) {
    console.info(
      [
        "",
        "──── MODEL PROMPT BEGIN ────",
        prompt,
        "───── MODEL PROMPT END ─────",
        "",
      ].join("\n"),
    );
  }

  if (event.type === "model.response.raw" && response !== undefined) {
    console.info("MODEL RAW RESPONSE:", JSON.stringify(response));
  }

  if (
    event.type === "model.response.envelope" &&
    (envelopeContent !== undefined || envelopeThinking !== undefined)
  ) {
    console.info(
      "MODEL RESPONSE ENVELOPE:",
      JSON.stringify({
        content: envelopeContent,
        thinking: envelopeThinking,
      }),
    );
  }
}

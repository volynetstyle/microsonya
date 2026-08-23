export type SummarizationTelemetryContext = {
  traceId: string;
  chatId: string;
  commandMessageId: number;
};

export type SummarizationTelemetryPayload =
  | {
      type: "summary.start";
      mode: string;
    }
  | {
      type: "messages.loaded";
      messageCount: number;
      hasPreviousRun: boolean;
    }
  | {
      type: "messages.selected";
      messageCount: number;
      fromMessageId?: number;
      toMessageId?: number;
    }
  | {
      type: "model.request";
      messageCount: number;
      promptChars: number;
      prompt?: string;
    }
  | {
      type: "model.response";
      durationMs: number;
      summaryChars: number;
    }
  | {
      type: "summary.saved";
      durationMs: number;
    }
  | {
      type: "summary.finish";
      durationMs: number;
      status: "ok" | "empty";
    }
  | {
      type: "summary.error";
      durationMs: number;
      stage: string;
      error: {
        name?: string;
        message: string;
        stack?: string;
      };
    };

export type SummarizationTelemetryEvent =
  SummarizationTelemetryContext &
    SummarizationTelemetryPayload & {
      offsetMs: number;
    };

export type SummarizationTelemetryOptions = {
  includePrompt?: boolean;
};

export class SummarizationTelemetryService {
  constructor(
    private readonly sink: (
      event: SummarizationTelemetryEvent,
    ) => void = log,
    private readonly options: SummarizationTelemetryOptions = {
      includePrompt: process.env.SUMMARIZATION_LOG_PROMPT === "1",
    },
  ) {}

  start(
    context: SummarizationTelemetryContext,
  ): SummarizationTelemetryTrace {
    return new SummarizationTelemetryTrace(
      context,
      this.sink,
      this.options,
    );
  }
}

export class SummarizationTelemetryTrace {
  private readonly startedAt = performance.now();

  constructor(
    private readonly context: SummarizationTelemetryContext,
    private readonly sink: (
      event: SummarizationTelemetryEvent,
    ) => void,
    private readonly options: SummarizationTelemetryOptions,
  ) {}

  record(payload: SummarizationTelemetryPayload): void {
    if (
      payload.type === "model.request" &&
      !this.options.includePrompt
    ) {
      const { prompt: _, ...withoutPrompt } = payload;

      this.emit(withoutPrompt);
      return;
    }

    this.emit(payload);
  }

  private emit(payload: SummarizationTelemetryPayload): void {
    this.sink({
      ...this.context,
      ...payload,
      offsetMs: performance.now() - this.startedAt,
    });
  }
}

function log(event: SummarizationTelemetryEvent): void {
  const {
    prompt,
    ...metadata
  } = event.type === "model.request"
    ? event
    : { ...event, prompt: undefined };

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
}
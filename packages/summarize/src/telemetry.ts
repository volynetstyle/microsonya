import type {
  ChatId,
  MessageId,
  SummaryAction,
  SummaryMode,
} from "@microsonya/shared";
import type { StructuralAnalysis } from "./views.js";
import type { ClassificationPredicates } from "./classifier.js";

export type ModelStage = "classifier" | "summarizer";
export type ModelOutputFailure =
  | "MODEL_OUTPUT_EMPTY"
  | "MODEL_OUTPUT_INVALID_JSON"
  | "MODEL_OUTPUT_SCHEMA_MISMATCH";

export type SummarizationTelemetryContext = {
  traceId: string;
  chatId: ChatId;
  commandMessageId: MessageId;
};

export type SummarizationTelemetryPayload =
  | {
      type: "summary.start";
      mode: SummaryMode;
    }
  | {
      type: "messages.loaded";
      messageCount: number;
      hasPreviousRun: boolean;
    }
  | {
      type: "messages.selected";
      messageCount: number;
      fromMessageId?: MessageId;
      toMessageId?: MessageId;
    }
  | {
      type: "window.analyzed";
      analysis: StructuralAnalysis;
    }
  | {
      type: "window.fast-classifier";
      result: "abstain" | "resolved";
      action?: SummaryAction;
      rule?: string;
    }
  | {
      type: "model.request";
      stage: ModelStage;
      model: string;
      attempt?: number;
      numPredict?: number;
      messageCount: number;
      promptChars: number;
      prompt?: string;
    }
  | {
      type: "model.response.envelope";
      stage: ModelStage;
      model: string;
      attempt: number;
      durationMs: number;
      done: boolean;
      doneReason?: string;
      promptEvalCount?: number;
      evalCount?: number;
      contentChars: number;
      thinkingChars: number;
      content?: string;
      thinking?: string;
    }
  | {
      type: "model.request.retry";
      stage: ModelStage;
      model: string;
      failedAttempt: number;
      nextAttempt: number;
      reason: ModelOutputFailure;
    }
  | {
      type: "model.response.raw";
      stage: ModelStage;
      model: string;
      attempt?: number;
      durationMs: number;
      responseChars: number;
      response?: string;
    }
  | {
      type: "model.response.invalid";
      stage: ModelStage;
      model: string;
      attempt?: number;
      durationMs: number;
      responseChars: number;
      reason: ModelOutputFailure;
    }
  | {
      type: "model.response";
      stage: ModelStage;
      model: string;
      attempt?: number;
      durationMs: number;
      responseChars: number;
      action?: SummaryAction;
      summaryChars?: number;
      predicates?: ClassificationPredicates;
    }
  | {
      type: "summary.saved";
      durationMs: number;
    }
  | {
      type: "window.decision";
      action: SummaryAction;
      source: "deterministic" | "model";
      model?: string;
      rule?: string;
    }
  | {
      type: "window.disposition";
      kind: "summarized" | "deferred" | "skipped";
      reason?: string;
      durationMs: number;
    }
  | {
      type: "summary.finish";
      durationMs: number;
      status: "summarized" | "deferred" | "skipped" | "empty";
    }
  | {
      type: "summary.error";
      durationMs: number;
      stage: string;
      error: {
        name?: string;
        code?: string;
        outputChars?: number;
        outputPreview?: string;
        message: string;
        stack?: string;
      };
    };

export type SummarizationTelemetryEvent = SummarizationTelemetryContext &
  SummarizationTelemetryPayload & {
    offsetMs: number;
  };

export type SummarizationTelemetryOptions = {
  includePrompt?: boolean;
  includeModelResponse?: boolean;
};

export class SummarizationTelemetryService {
  constructor(
    private readonly sink: (event: SummarizationTelemetryEvent) => void = log,
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

export class SummarizationTelemetryTrace {
  private readonly startedAt = performance.now();

  constructor(
    private readonly context: SummarizationTelemetryContext,
    private readonly sink: (event: SummarizationTelemetryEvent) => void,
    private readonly options: SummarizationTelemetryOptions,
  ) {}

  record(payload: SummarizationTelemetryPayload): void {
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

  private emit(payload: SummarizationTelemetryPayload): void {
    this.sink({
      ...this.context,
      ...payload,
      offsetMs: performance.now() - this.startedAt,
    });
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

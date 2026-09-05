import { createHash, randomUUID } from "node:crypto";
import type {
  ModelInvocationEvidence,
  ChatId,
  MessageId,
  SummaryId,
  SummaryAction,
  SummaryMode,
  TimestampMs,
} from "@microsonya/shared";
import { asSummaryId, asTimestampMs } from "@microsonya/shared";
import type { StructuralAnalysis } from "../evaluation/analyze-conversation.js";
import type { ClassificationPredicates } from "../evaluation/classify-conversation.js";

export type ModelStage = "classifier" | "summarizer";
export type ModelOutputFailure =
  | "MODEL_OUTPUT_EMPTY"
  | "MODEL_OUTPUT_INVALID_JSON"
  | "MODEL_OUTPUT_SCHEMA_MISMATCH";

export type SummaryErrorCode =
  | "MODEL_TIMEOUT"
  | "MODEL_PROVIDER_ERROR"
  | "MODEL_OUTPUT_INVALID"
  | "MODEL_OUTPUT_EMPTY"
  | "DELIVERY_ERROR"
  | "STORAGE_ERROR";

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
      contextMessageCount: number;
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
      type: "summary.run";
      action?: SummaryAction;
      messageCount: number;
      contextMessageCount: number;
      classifierMs: number;
      summarizerMs: number;
      totalMs: number;
      modelCalls: number;
      checkpointAdvanced: boolean;
      consecutiveDeferCount: number;
      status: "summarized" | "deferred" | "skipped" | "empty" | "error";
      errorCode?: SummaryErrorCode;
    }
  | {
      type: "summary.error";
      durationMs: number;
      stage: string;
      error: {
        name?: string;
        code: SummaryErrorCode;
        detailCode?: string;
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

export class SummarizationTelemetryTrace {
  readonly emitsEvents: boolean;
  private readonly startedAt: number;
  private modelCalls = 0;
  private classifierMs = 0;
  private summarizerMs = 0;
  private readonly invocations = new Map<string, MutableInvocation>();

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

  record(payload: SummarizationTelemetryPayload): void {
    if (payload.type === "model.request") {
      this.modelCalls += 1;
      const attempt = payload.attempt ?? 1;
      this.invocations.set(invocationKey(payload.stage, attempt), {
        id: asSummaryId(randomUUID()),
        stage: payload.stage,
        model: payload.model,
        promptHash: sha256(payload.prompt ?? ""),
        status: "pending",
        createdAt: asTimestampMs(Date.now()),
      });
    }
    if (payload.type === "model.response.envelope") {
      if (payload.stage === "classifier")
        this.classifierMs += payload.durationMs;
      else this.summarizerMs += payload.durationMs;
      const invocation = this.invocations.get(
        invocationKey(payload.stage, payload.attempt),
      );
      if (invocation !== undefined) {
        invocation.inputTokens = payload.promptEvalCount;
        invocation.outputTokens = payload.evalCount;
        invocation.latencyMs = payload.durationMs;
        invocation.outputText = payload.content;
      }
    }
    if (payload.type === "model.response.invalid") {
      const invocation = this.invocations.get(
        invocationKey(payload.stage, payload.attempt ?? 1),
      );
      if (invocation !== undefined) {
        invocation.status = "failed";
        invocation.errorCode = payload.reason;
      }
    }
    if (payload.type === "model.response") {
      const invocation = this.invocations.get(
        invocationKey(payload.stage, payload.attempt ?? 1),
      );
      if (invocation !== undefined) {
        invocation.status = "succeeded";
        if (payload.stage === "classifier") {
          invocation.outputJson = {
            ...payload.predicates,
            action: payload.action,
          };
        }
      }
    }
    // Evidence capture above is production-critical. Everything below only
    // prepares and emits the verbose development event stream.
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

  modelMetrics(): Readonly<{
    modelCalls: number;
    classifierMs: number;
    summarizerMs: number;
  }> {
    return Object.freeze({
      modelCalls: this.modelCalls,
      classifierMs: this.classifierMs,
      summarizerMs: this.summarizerMs,
    });
  }

  modelInvocations(
    errorCode?: SummaryErrorCode,
  ): readonly ModelInvocationEvidence[] {
    return Object.freeze(
      [...this.invocations.values()].map((invocation) =>
        Object.freeze({
          ...invocation,
          status:
            invocation.status === "pending" && errorCode !== undefined
              ? ("failed" as const)
              : invocation.status,
          errorCode:
            invocation.status === "pending" && errorCode !== undefined
              ? errorCode
              : invocation.errorCode,
        }),
      ),
    );
  }

  private emit(payload: SummarizationTelemetryPayload): void {
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

type MutableInvocation = {
  id: SummaryId;
  stage: ModelStage;
  model: string;
  promptHash: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  outputJson?: unknown;
  outputText?: string;
  status: ModelInvocationEvidence["status"];
  errorCode?: string;
  createdAt: TimestampMs;
};

function invocationKey(stage: ModelStage, attempt: number): string {
  return `${stage}:${attempt}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
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

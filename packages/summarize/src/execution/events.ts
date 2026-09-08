import type { MessageId, SummaryAction, SummaryMode } from "@microsonya/shared";
import type { ClassificationPredicates } from "../classifier/predicates.js";
import type { StructuralAnalysis } from "../window/analysis.js";

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

export type SummaryExecutionEvent =
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

import {
  SummarizationTelemetryService,
  type SummarizationTelemetryEvent,
} from "@microsonya/summarize";
import { recordAnalyticsPoint } from "../observability.js";
import { logTelemetry } from "../observability.js";
import type { SummaryId } from "@microsonya/shared";

/**
 * Fixed Analytics Engine schema for the summarization pipeline.
 *
 * blob1 event type       double1 duration/offset ms
 * blob2 status/result    double2 eligible messages
 * blob3 stage/source     double3 context messages
 * blob4 action/reason    double4 model calls/input tokens
 * blob5 error code       double5 classifier ms/output tokens
 * blob6 mode/rule        double6 summarizer ms/character count
 *                        double7 checkpoint advanced (0/1)
 *
 * No chat id, message id, run id, prompt, response, summary, author, or raw
 * exception is emitted. The single index is deliberately low-cardinality.
 */
export function createProcessorTelemetry(
  analytics: AnalyticsEngineDataset,
  runId?: SummaryId,
): SummarizationTelemetryService {
  return new SummarizationTelemetryService(
    (event) => {
      recordSummarizationEvent(analytics, event);
      if (runId !== undefined && event.type === "summary.error") {
        logTelemetry("error", "processor", "summary.generate.failed", {
          runId,
          internalStage: event.stage,
          summaryErrorCode: event.error.code,
          errorName: event.error.name ?? "UNKNOWN_ERROR",
        });
      }
    },
    { includePrompt: false, includeModelResponse: false },
  );
}

export function recordSummarizationEvent(
  analytics: AnalyticsEngineDataset,
  event: SummarizationTelemetryEvent,
): void {
  const projection = projectEvent(event);
  recordAnalyticsPoint(analytics, {
    component: "processor",
    index: "processor:summary",
    blobs: [
      event.type,
      projection.status,
      projection.stage,
      projection.action,
      projection.errorCode,
      projection.mode,
    ],
    doubles: [
      projection.durationMs ?? event.offsetMs,
      projection.messageCount,
      projection.contextMessageCount,
      projection.modelCalls,
      projection.classifierMs,
      projection.summarizerMs,
      projection.checkpointAdvanced ? 1 : 0,
    ],
  });
}

type Projection = {
  status: string;
  stage: string;
  action: string;
  errorCode: string;
  mode: string;
  durationMs?: number;
  messageCount: number;
  contextMessageCount: number;
  modelCalls: number;
  classifierMs: number;
  summarizerMs: number;
  checkpointAdvanced: boolean;
};

function projectEvent(event: SummarizationTelemetryEvent): Projection {
  const base: Projection = {
    status: "",
    stage: "",
    action: "",
    errorCode: "",
    mode: "",
    messageCount: 0,
    contextMessageCount: 0,
    modelCalls: 0,
    classifierMs: 0,
    summarizerMs: 0,
    checkpointAdvanced: false,
  };
  switch (event.type) {
    case "summary.start":
      return { ...base, mode: event.mode };
    case "messages.loaded":
      return { ...base, messageCount: event.messageCount };
    case "messages.selected":
      return {
        ...base,
        messageCount: event.messageCount,
        contextMessageCount: event.contextMessageCount,
      };
    case "model.request":
      return {
        ...base,
        stage: event.stage,
        messageCount: event.messageCount,
        modelCalls: 1,
        summarizerMs: event.promptChars,
      };
    case "model.response.envelope":
      return {
        ...base,
        status: event.doneReason ?? (event.done ? "done" : "partial"),
        stage: event.stage,
        durationMs: event.durationMs,
        modelCalls: event.promptEvalCount ?? 0,
        classifierMs: event.evalCount ?? 0,
        summarizerMs: event.contentChars + event.thinkingChars,
      };
    case "model.request.retry":
      return {
        ...base,
        status: "retry",
        stage: event.stage,
        errorCode: event.reason,
        modelCalls: event.nextAttempt,
      };
    case "model.response.raw":
    case "model.response.invalid":
    case "model.response":
      return {
        ...base,
        status: event.type === "model.response.invalid" ? "invalid" : "ok",
        stage: event.stage,
        action: event.type === "model.response" ? (event.action ?? "") : "",
        errorCode: event.type === "model.response.invalid" ? event.reason : "",
        durationMs: event.durationMs,
        summarizerMs: event.responseChars,
      };
    case "window.fast-classifier":
      return {
        ...base,
        status: event.result,
        action: event.action ?? "",
        mode: event.rule ?? "",
      };
    case "window.decision":
      return {
        ...base,
        status: event.source,
        action: event.action,
        mode: event.rule ?? "",
      };
    case "window.disposition":
      return {
        ...base,
        status: event.kind,
        action: event.reason ?? "",
        durationMs: event.durationMs,
      };
    case "summary.saved":
    case "summary.finish":
      return {
        ...base,
        status: event.type === "summary.finish" ? event.status : "saved",
        durationMs: event.durationMs,
      };
    case "summary.run":
      return {
        ...base,
        status: event.status,
        action: event.action ?? "",
        errorCode: event.errorCode ?? "",
        durationMs: event.totalMs,
        messageCount: event.messageCount,
        contextMessageCount: event.contextMessageCount,
        modelCalls: event.modelCalls,
        classifierMs: event.classifierMs,
        summarizerMs: event.summarizerMs,
        checkpointAdvanced: event.checkpointAdvanced,
      };
    case "summary.error":
      return {
        ...base,
        status: "error",
        stage: event.stage,
        errorCode: event.error.code,
        durationMs: event.durationMs,
      };
    case "window.analyzed":
      return {
        ...base,
        modelCalls: event.analysis.turnCount,
      };
  }
}

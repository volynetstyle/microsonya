import type {
  ModelInvocationEvidence,
  SummaryId,
  TimestampMs,
} from "@microsonya/shared";
import { createHash } from "node:crypto";
import { defaultNow, defaultSummaryId } from "./defaults.js";
import type {
  ModelStage,
  SummaryErrorCode,
  SummaryExecutionEvent,
} from "./events.js";
import type { SummaryExecutionRecorder } from "./observer.js";

export interface SummaryExecutionRecord {
  readonly modelCalls: number;
  readonly classifierMs: number;
  readonly summarizerMs: number;
  readonly modelInvocations: readonly ModelInvocationEvidence[];
}

/** Durable execution provenance. It must not depend on telemetry being enabled. */
export class SummaryExecutionJournal implements SummaryExecutionRecorder {
  private modelCalls = 0;
  private classifierMs = 0;
  private summarizerMs = 0;
  private readonly invocations = new Map<string, MutableInvocation>();

  constructor(
    private readonly createInvocationId: () => SummaryId = defaultSummaryId,
    private readonly now: () => TimestampMs = defaultNow,
  ) {}

  record(event: SummaryExecutionEvent): void {
    if (event.type === "model.request") {
      this.modelCalls += 1;
      const attempt = event.attempt ?? 1;
      this.invocations.set(invocationKey(event.stage, attempt), {
        id: this.createInvocationId(),
        stage: event.stage,
        model: event.model,
        promptHash: sha256(event.prompt ?? ""),
        status: "pending",
        createdAt: this.now(),
      });
    }
    if (event.type === "model.response.envelope") {
      if (event.stage === "classifier") this.classifierMs += event.durationMs;
      else if (event.stage === "summarizer")
        this.summarizerMs += event.durationMs;
      const invocation = this.invocations.get(
        invocationKey(event.stage, event.attempt),
      );
      if (invocation !== undefined) {
        invocation.inputTokens = event.promptEvalCount;
        invocation.outputTokens = event.evalCount;
        invocation.latencyMs = event.durationMs;
        invocation.outputText = event.content;
      }
    }
    if (
      event.type === "model.response.invalid" ||
      event.type === "summary.acceptance.rejected"
    ) {
      const invocation = this.invocations.get(
        invocationKey(event.stage, event.attempt ?? 1),
      );
      if (invocation !== undefined) {
        invocation.status = "failed";
        invocation.errorCode = event.reason;
      }
    }
    if (event.type === "model.response") {
      const invocation = this.invocations.get(
        invocationKey(event.stage, event.attempt ?? 1),
      );
      if (invocation !== undefined) {
        invocation.status = "succeeded";
        if (event.stage === "classifier") {
          invocation.outputJson = {
            ...event.predicates,
            action: event.action,
          };
        }
      }
    }
  }

  snapshot(errorCode?: SummaryErrorCode): SummaryExecutionRecord {
    return {
      modelCalls: this.modelCalls,
      classifierMs: this.classifierMs,
      summarizerMs: this.summarizerMs,
      modelInvocations: [...this.invocations.values()].map((invocation) => ({
        ...invocation,
        status:
          invocation.status === "pending" && errorCode !== undefined
            ? ("failed" as const)
            : invocation.status,
        errorCode:
          invocation.status === "pending" && errorCode !== undefined
            ? errorCode
            : invocation.errorCode,
      })),
    };
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

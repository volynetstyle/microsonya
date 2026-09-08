import { createHash, randomUUID } from "node:crypto";
import {
  asSummaryId,
  asTimestampMs,
  type ChatId,
  type MessageId,
  type ModelInvocationEvidence,
  type SummaryId,
  type TimestampMs,
} from "@microsonya/shared";
import type {
  ModelStage,
  SummaryExecutionEvent,
  SummaryErrorCode,
} from "./telemetry.js";

export interface SummaryExecutionRecorder {
  record(event: SummaryExecutionEvent): void;
}

export interface SummaryExecutionContext {
  readonly traceId: string;
  readonly chatId: ChatId;
  readonly commandMessageId: MessageId;
}

/** Optional projection boundary. Implementations must not affect execution. */
export interface SummaryExecutionObserver {
  start(context: SummaryExecutionContext): SummaryExecutionRecorder;
}

export function startOptionalExecutionObserver(
  observer: SummaryExecutionObserver | undefined,
  context: SummaryExecutionContext,
): SummaryExecutionRecorder | undefined {
  if (observer === undefined) return undefined;
  try {
    const recorder = observer.start(context);
    return {
      record(event): void {
        try {
          recorder.record(event);
        } catch {
          // Operational projections are auxiliary. Evidence is recorded by a
          // separate required journal before this observer is invoked.
        }
      },
    };
  } catch {
    return undefined;
  }
}

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
    private readonly createInvocationId: () => SummaryId = () =>
      asSummaryId(randomUUID()),
    private readonly now: () => TimestampMs = () => asTimestampMs(Date.now()),
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
      else this.summarizerMs += event.durationMs;
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
    if (event.type === "model.response.invalid") {
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

export function combineSummaryExecutionRecorders(
  ...recorders: readonly (SummaryExecutionRecorder | undefined)[]
): SummaryExecutionRecorder {
  return {
    record(event): void {
      for (const recorder of recorders) recorder?.record(event);
    },
  };
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

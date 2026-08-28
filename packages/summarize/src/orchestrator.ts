import { randomUUID } from "node:crypto";
import {
  asSummaryId,
  asTimestampMs,
  type ConversationWindow,
  type SummaryDecision,
  type SummaryId,
  type TimestampMs,
  type WindowDisposition,
} from "@microsonya/shared";
import type { SummaryDecisionClassifier } from "./classifier.js";
import type { ConversationSummarizer } from "./conversationSummarizer.js";
import type { SummarizationTelemetryTrace } from "./telemetry.js";
import { analyzeStructure, type StructuralAnalysis } from "./views.js";

export type FastRule = string;

export type FastDecision =
  | {
      readonly kind: "resolved";
      readonly action: SummaryDecision["action"];
      readonly rule: FastRule;
    }
  | { readonly kind: "abstain" };

export interface FastClassifier {
  classify(
    window: ConversationWindow,
    analysis: StructuralAnalysis,
  ): FastDecision;
}

/** Structural features are available, but v0.1 has no approved fast rules. */
export const abstainingFastClassifier: FastClassifier = Object.freeze({
  classify: (): FastDecision => ({ kind: "abstain" }),
});

export interface WindowProcessorDeps {
  readonly classifier: SummaryDecisionClassifier;
  readonly summarizer: ConversationSummarizer;
  readonly fastClassifier?: FastClassifier;
  readonly createSummaryId?: () => SummaryId;
  readonly now?: () => TimestampMs;
  readonly telemetry?: SummarizationTelemetryTrace;
}

export interface WindowProcessingResult {
  readonly decision: SummaryDecision;
  readonly disposition: WindowDisposition;
}

export function decideWindow(
  window: ConversationWindow,
  classifier: SummaryDecisionClassifier,
  signal?: AbortSignal,
  fastClassifier: FastClassifier = abstainingFastClassifier,
  telemetry?: SummarizationTelemetryTrace,
): Promise<SummaryDecision> {
  signal?.throwIfAborted();
  const analysis = analyzeStructure(window);
  if (telemetry?.emitsEvents) {
    telemetry.record({ type: "window.analyzed", analysis });
  }
  const fast = fastClassifier.classify(window, analysis);
  if (telemetry?.emitsEvents) {
    telemetry.record({
      type: "window.fast-classifier",
      result: fast.kind === "abstain" ? "abstain" : "resolved",
      ...(fast.kind === "resolved"
        ? { action: fast.action, rule: fast.rule }
        : {}),
    });
  }

  if (fast.kind === "resolved") {
    return Promise.resolve(
      Object.freeze({
        action: fast.action,
        evidence: Object.freeze({
          source: "deterministic" as const,
          rule: fast.rule,
        }),
      }),
    );
  }

  return classifier.classify(window, signal, telemetry);
}

export async function processWindow(
  window: ConversationWindow,
  deps: WindowProcessorDeps,
  signal?: AbortSignal,
): Promise<WindowProcessingResult> {
  const startedAt = deps.telemetry?.emitsEvents ? performance.now() : 0;
  const decision = await decideWindow(
    window,
    deps.classifier,
    signal,
    deps.fastClassifier,
    deps.telemetry,
  );
  signal?.throwIfAborted();
  if (deps.telemetry?.emitsEvents) {
    deps.telemetry.record({
      type: "window.decision",
      action: decision.action,
      source: decision.evidence.source,
      ...(decision.evidence.source === "model"
        ? { model: decision.evidence.model }
        : { rule: decision.evidence.rule }),
    });
  }
  let disposition: WindowDisposition;
  if (decision.action === "SUMMARIZE") {
    const generated = await deps.summarizer.summarize(
      window,
      signal,
      deps.telemetry,
    );
    signal?.throwIfAborted();
    const messages = window.messages;
    disposition = Object.freeze({
      kind: "summarized",
      summary: Object.freeze({
        id: (deps.createSummaryId ?? defaultSummaryId)(),
        chatId: window.chatId,
        covers: Object.freeze({
          firstId: messages[0]!.id,
          lastId: messages[messages.length - 1]!.id,
          count: messages.length,
        }),
        text: generated.text,
        createdAt: (deps.now ?? defaultNow)(),
      }),
    });
  } else {
    switch (decision.action) {
      case "DEFER_COMPACT":
      case "DEFER_INCOMPLETE":
      case "DEFER_CONTEXT":
        disposition = Object.freeze({
          kind: "deferred",
          reason: decision.action,
        });
        break;
      case "SKIP_REACTIONS":
      case "SKIP_BANTER":
      case "SKIP_NO_VALUE":
        disposition = Object.freeze({
          kind: "skipped",
          reason: decision.action,
        });
        break;
    }
  }
  if (deps.telemetry?.emitsEvents) {
    deps.telemetry.record({
      type: "window.disposition",
      kind: disposition.kind,
      ...(disposition.kind === "summarized"
        ? {}
        : { reason: disposition.reason }),
      durationMs: performance.now() - startedAt,
    });
  }

  return Object.freeze({ decision, disposition });
}

function defaultSummaryId(): SummaryId {
  return asSummaryId(randomUUID());
}

function defaultNow(): TimestampMs {
  return asTimestampMs(Date.now());
}

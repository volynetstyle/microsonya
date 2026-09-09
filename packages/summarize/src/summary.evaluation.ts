import type {
  ChatMessage,
  ConversationWindow,
  SummaryDecision,
  SummaryId,
  TimestampMs,
  WindowDisposition,
} from "@microsonya/shared";
import type { SummaryDecisionClassifier } from "./classifier/classifier.js";
import type { FastClassifier } from "./classifier/decision.js";
import { decideWindow } from "./classifier/decision.js";
import { defaultNow, defaultSummaryId } from "./execution/defaults.js";
import type { SummaryExecutionRecorder } from "./execution/observer.js";
import type { ConversationSummarizer } from "./generation/summarizer.js";
import type { ModelWindowMessageRole } from "./model/prompt.js";
import { coverageOf } from "./window/coverage.js";
import { generateAcceptedSummary } from "./generation/generate-accepted.js";
import type { SummarySemanticReviewer } from "./generation/reviewer.js";

export interface SummaryEvaluationDependencies {
  readonly semanticReviewer: SummarySemanticReviewer;
  readonly eligibleMessages?: readonly ChatMessage[];
  readonly classifier: SummaryDecisionClassifier;
  readonly summarizer: ConversationSummarizer;
  readonly fastClassifier?: FastClassifier;
  readonly createSummaryId?: () => SummaryId;
  readonly now?: () => TimestampMs;
  readonly execution?: SummaryExecutionRecorder;
  readonly roles?: readonly ModelWindowMessageRole[];
}

export interface SummaryEvaluationResult {
  readonly decision: SummaryDecision;
  readonly disposition: WindowDisposition;
}

export async function evaluateSummaryWindow(
  window: ConversationWindow,
  deps: SummaryEvaluationDependencies,
  signal?: AbortSignal,
): Promise<SummaryEvaluationResult> {
  const startedAt = performance.now();
  const decision = await decideWindow(
    window,
    deps.classifier,
    signal,
    deps.fastClassifier,
    deps.execution,
    deps.roles,
  );
  signal?.throwIfAborted();
  deps.execution?.record({
    type: "window.decision",
    action: decision.action,
    source: decision.evidence.source,
    ...(decision.evidence.source === "model"
      ? { model: decision.evidence.model }
      : { rule: decision.evidence.rule }),
  });
  let disposition: WindowDisposition;
  if (decision.action === "SUMMARIZE") {
    const text = await generateAcceptedSummary(
      window,
      deps.summarizer,
      deps.semanticReviewer,
      signal,
      deps.execution,
      deps.roles,
    );
    signal?.throwIfAborted();
    const messages = deps.eligibleMessages ?? window.messages;
    disposition = {
      kind: "summarized",
      summary: {
        id: (deps.createSummaryId ?? defaultSummaryId)(),
        chatId: window.chatId,
        covers: coverageOf(messages),
        text,
        createdAt: (deps.now ?? defaultNow)(),
      },
    };
  } else {
    switch (decision.action) {
      case "DEFER_COMPACT":
      case "DEFER_INCOMPLETE":
      case "DEFER_CONTEXT":
        disposition = {
          kind: "deferred",
          reason: decision.action,
        };
        break;
      case "SKIP_REACTIONS":
      case "SKIP_BANTER":
      case "SKIP_NO_VALUE":
        disposition = {
          kind: "skipped",
          reason: decision.action,
        };
        break;
    }
  }
  deps.execution?.record({
    type: "window.disposition",
    kind: disposition.kind,
    ...(disposition.kind === "summarized"
      ? {}
      : { reason: disposition.reason }),
    durationMs: performance.now() - startedAt,
  });

  return { decision, disposition };
}

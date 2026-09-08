import type { ConversationWindow, SummaryDecision } from "@microsonya/shared";
import type { SummaryExecutionRecorder } from "../execution/observer.js";
import type { ModelWindowMessageRole } from "../model/prompt.js";
import type { StructuralAnalysis } from "../window/analysis.js";
import { analyzeStructure } from "../window/analysis.js";
import type { SummaryDecisionClassifier } from "./classifier.js";

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
export const abstainingFastClassifier: FastClassifier = {
  classify: (): FastDecision => ({ kind: "abstain" }),
};

export async function decideWindow(
  window: ConversationWindow,
  classifier: SummaryDecisionClassifier,
  signal?: AbortSignal,
  fastClassifier: FastClassifier = abstainingFastClassifier,
  execution?: SummaryExecutionRecorder,
  roles?: readonly ModelWindowMessageRole[],
): Promise<SummaryDecision> {
  signal?.throwIfAborted();
  const analysis = analyzeStructure(window);
  execution?.record({ type: "window.analyzed", analysis });
  const fast = fastClassifier.classify(window, analysis);
  execution?.record({
    type: "window.fast-classifier",
    result: fast.kind === "abstain" ? "abstain" : "resolved",
    ...(fast.kind === "resolved"
      ? { action: fast.action, rule: fast.rule }
      : {}),
  });

  if (fast.kind === "resolved") {
    return {
      action: fast.action,
      evidence: {
        source: "deterministic" as const,
        rule: fast.rule,
      },
    };
  }

  return classifier.classify(window, signal, execution, roles);
}

import {
  isDecision,
  type DiscourseReconstruction,
  type DiscourseState,
  type ProjectedSummary,
} from "@microsonya/experimental-discourse";
import type {
  EvalMessage,
  ExtractorMetrics,
  Gold,
  ReducerMetrics,
} from "./types.js";

export function scoreExtractor(
  reconstruction: DiscourseReconstruction,
  messages: EvalMessage[],
  gold: Gold,
): ExtractorMetrics {
  const messageById = new Map(messages.map((message) => [message.id, message]));
  const expected = [...gold.claims, ...gold.decisions, ...gold.openQuestions];
  const matchedExpected = new Set<number>();
  let matchedEvents = 0;
  for (const event of reconstruction.events) {
    const match = expected
      .map((item, index) => ({
        index,
        overlap: overlap(event.evidence, item.evidence),
      }))
      .filter((item) => !matchedExpected.has(item.index))
      .sort((left, right) => right.overlap - left.overlap)[0];
    if (match && match.overlap > 0) {
      matchedEvents += 1;
      matchedExpected.add(match.index);
    }
  }

  const citations = reconstruction.events.flatMap((event) => event.evidence);
  const attributed = reconstruction.events.filter((event) =>
    event.evidence.some((id) => messageById.get(id)?.user === event.speaker),
  ).length;
  const relations = reconstruction.events.flatMap((event) => event.refersTo);
  const eventIds = new Set(reconstruction.events.map((event) => event.id));

  return {
    eventCount: reconstruction.events.length,
    eventRecall:
      expected.length === 0 ? null : matchedExpected.size / expected.length,
    eventPrecision:
      reconstruction.events.length === 0
        ? null
        : matchedEvents / reconstruction.events.length,
    attributionAccuracy:
      reconstruction.events.length === 0
        ? null
        : attributed / reconstruction.events.length,
    evidenceCorrectness:
      citations.length === 0
        ? null
        : citations.filter((id) => messageById.has(id)).length /
          citations.length,
    relationIntegrity:
      relations.length === 0
        ? 1
        : relations.filter((id) => eventIds.has(id)).length / relations.length,
  };
}

export function scoreReducer(
  state: DiscourseState,
  summary: ProjectedSummary,
): ReducerMetrics {
  const eventsByEvidence = new Map(
    state.events.flatMap((event) =>
      event.evidence.map((id) => [id, event] as const),
    ),
  );
  const projectedDecisions = summary.decisions.flatMap((item) =>
    item.evidence.map((id) => eventsByEvidence.get(id)),
  );
  const projectedQuestions = summary.openQuestions.flatMap((item) =>
    item.evidence.map((id) => eventsByEvidence.get(id)),
  );
  const projectedClaims = summary.topics
    .flatMap((topic) => topic.claims)
    .flatMap((item) => item.evidence.map((id) => eventsByEvidence.get(id)));
  const resolved = new Set(state.resolvedQuestionIds);
  const superseded = new Set(state.supersededEventIds);
  const violations =
    projectedDecisions.filter((event) => !event || !isDecision(event)).length +
    projectedQuestions.filter((event) => event && resolved.has(event.id))
      .length +
    projectedClaims.filter((event) => event && superseded.has(event.id)).length;
  return {
    deterministic: true,
    lifecycleInvariantViolations: violations,
    resolvedQuestions: state.resolvedQuestionIds.length,
    supersededEvents: state.supersededEventIds.length,
  };
}

function overlap(left: number[], right: number[]): number {
  const rightSet = new Set(right);
  return new Set(left.filter((id) => rightSet.has(id))).size;
}

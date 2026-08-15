import { isDecision } from "./invariants.js";
import { rankBySalience } from "./salience.js";
import type {
  DiscourseEvent,
  DiscourseReconstruction,
  ProjectedSummary,
  ProjectionDiagnostics,
} from "./types.js";

const MAX_CLAIMS = 8;
const MAX_DECISIONS = 5;
const MAX_OPEN_QUESTIONS = 5;

export function projectDiscourse(reconstruction: DiscourseReconstruction): {
  summary: ProjectedSummary;
  diagnostics: ProjectionDiagnostics;
} {
  const eventsById = new Map(
    reconstruction.events.map((event) => [event.id, event]),
  );
  const decisionCandidates = reconstruction.events.filter(
    (event) => event.action !== null || event.commitment !== "none",
  );
  const decisions = rankBySalience(decisionCandidates.filter(isDecision))
    .slice(0, MAX_DECISIONS)
    .map(toEvidenceItem);

  const resolvedQuestionIds = new Set(
    reconstruction.events
      .filter((event) => event.speechAct === "answer")
      .flatMap((event) => event.refersTo)
      .filter((id) => eventsById.get(id)?.speechAct === "question"),
  );
  const suppressedClaimIds = new Set([
    ...reconstruction.events
      .filter((event) => event.literalness === "ironic")
      .flatMap((event) => event.refersTo),
    ...reconstruction.events
      .filter(
        (event) =>
          event.speechAct === "correction" &&
          event.epistemicStatus === "accepted",
      )
      .flatMap((event) => event.refersTo),
  ]);
  const openQuestions = rankBySalience(
    reconstruction.events.filter(
      (event) =>
        event.speechAct === "question" && !resolvedQuestionIds.has(event.id),
    ),
  )
    .slice(0, MAX_OPEN_QUESTIONS)
    .map(toEvidenceItem);
  const claimEvents = rankBySalience(
    reconstruction.events.filter(
      (event) => isClaim(event) && !suppressedClaimIds.has(event.id),
    ),
  ).slice(0, MAX_CLAIMS);
  const topicIds = [...new Set(claimEvents.map((event) => event.topicId))];
  const topics = topicIds.map((topicId) => {
    const events = claimEvents.filter((event) => event.topicId === topicId);
    return {
      id: topicId,
      title: events[0]?.topicTitle ?? topicId,
      claims: events.map(toEvidenceItem),
    };
  });

  return {
    summary: { title: reconstruction.title, topics, decisions, openQuestions },
    diagnostics: {
      decisionCandidates: decisionCandidates.length,
      decisionsRejectedByInvariant:
        decisionCandidates.length - decisions.length,
      questionsResolvedByAnswerEdge: resolvedQuestionIds.size,
    },
  };
}

function isClaim(event: DiscourseEvent): boolean {
  return (
    event.speechAct !== "question" &&
    event.speechAct !== "request" &&
    event.literalness !== "ironic" &&
    event.epistemicStatus !== "rejected" &&
    !isDecision(event)
  );
}

function toEvidenceItem(event: DiscourseEvent) {
  return {
    text: `${event.speaker}: ${event.statement}`,
    evidence: event.evidence,
  };
}

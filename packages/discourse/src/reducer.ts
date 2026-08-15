import { isDecision } from "./invariants.js";
import type {
  DiscourseEvent,
  DiscourseReconstruction,
  DiscourseState,
} from "./types.js";

/** Materializes lifecycle state from a replayable semantic event log. */
export function reduceDiscourse(
  reconstruction: DiscourseReconstruction,
): DiscourseState {
  const events = canonicalEvents(reconstruction.events);
  const eventsById = new Map(events.map((event) => [event.id, event]));
  const resolvedQuestionIds = new Set<string>();
  const supersededEventIds = new Set<string>();

  for (const event of events) {
    for (const targetId of event.refersTo) {
      const target = eventsById.get(targetId);
      if (!target) continue;
      if (event.speechAct === "answer" && target.speechAct === "question") {
        resolvedQuestionIds.add(targetId);
      }
      if (
        event.epistemicStatus === "accepted" &&
        (event.speechAct === "correction" ||
          (isDecision(event) && isDecision(target)))
      ) {
        supersededEventIds.add(targetId);
      }
    }
  }

  return {
    title: reconstruction.title,
    events,
    resolvedQuestionIds: [...resolvedQuestionIds].sort(),
    supersededEventIds: [...supersededEventIds].sort(),
  };
}

function canonicalEvents(events: DiscourseEvent[]): DiscourseEvent[] {
  const byId = new Map<string, DiscourseEvent>();
  for (const event of events) {
    const existing = byId.get(event.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(event)) {
      throw new Error(`Conflicting discourse event id: ${event.id}`);
    }
    byId.set(event.id, event);
  }
  return [...byId.values()].sort(
    (left, right) =>
      Math.min(...left.evidence) - Math.min(...right.evidence) ||
      left.id.localeCompare(right.id),
  );
}

import { isDecision } from "./invariants.js";
import type { DiscourseEvent } from "./types.js";

export function rankBySalience(events: DiscourseEvent[]): DiscourseEvent[] {
  const referenceCounts = countReferences(events);
  return [...events].sort(
    (left, right) =>
      salience(right, referenceCounts) - salience(left, referenceCounts),
  );
}

function countReferences(events: DiscourseEvent[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const event of events) {
    for (const target of event.refersTo) {
      counts.set(target, (counts.get(target) ?? 0) + 1);
    }
  }
  return counts;
}

function salience(
  event: DiscourseEvent,
  referenceCounts: ReadonlyMap<string, number>,
): number {
  const centrality = Math.min((referenceCounts.get(event.id) ?? 0) / 3, 1);
  const lifecycleImpact =
    event.speechAct === "answer" ||
    isDecision(event) ||
    event.epistemicStatus === "rejected"
      ? 1
      : 0;
  const evidenceBreadth = Math.min(event.evidence.length / 3, 1);
  const recency = Math.min(Math.max(...event.evidence) / 10_000, 1);
  return (
    0.35 * event.semanticImportance +
    0.2 * centrality +
    0.2 * lifecycleImpact +
    0.15 * evidenceBreadth +
    0.1 * recency -
    (event.literalness === "ironic" ? 0.25 : 0)
  );
}

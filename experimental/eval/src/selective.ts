import type { EvalMessage, ProjectedSummary } from "./types.js";

export type ClaimSelectionPolicy = {
  topK: number;
  minEvidence: number;
  rankBy: "model-order" | "evidence-count" | "reply-centrality";
};

export function selectSummaryClaims(
  summary: ProjectedSummary,
  messages: EvalMessage[],
  policy: ClaimSelectionPolicy,
): ProjectedSummary {
  const validIds = new Set(messages.map((message) => message.id));
  const replyDegree = new Map<number, number>();
  for (const message of messages) {
    replyDegree.set(message.id, replyDegree.get(message.id) ?? 0);
    if (message.replyTo != null) {
      replyDegree.set(message.id, (replyDegree.get(message.id) ?? 0) + 1);
      replyDegree.set(
        message.replyTo,
        (replyDegree.get(message.replyTo) ?? 0) + 1,
      );
    }
  }

  const candidates = summary.topics.flatMap((topic, topicIndex) =>
    topic.claims.map((claim, claimIndex) => {
      const evidence = [...new Set(claim.evidence)];
      return {
        topic,
        topicIndex,
        claim,
        claimIndex,
        evidence,
        originalIndex: topicIndex * 1_000 + claimIndex,
        replyCentrality: evidence.reduce(
          (sum, id) => sum + (replyDegree.get(id) ?? 0),
          0,
        ),
      };
    }),
  );
  const eligible = candidates.filter(
    (candidate) =>
      candidate.evidence.length >= policy.minEvidence &&
      candidate.evidence.every((id) => validIds.has(id)),
  );
  eligible.sort((left, right) => {
    if (policy.rankBy === "evidence-count") {
      return (
        right.evidence.length - left.evidence.length ||
        left.originalIndex - right.originalIndex
      );
    }
    if (policy.rankBy === "reply-centrality") {
      return (
        right.replyCentrality - left.replyCentrality ||
        right.evidence.length - left.evidence.length ||
        left.originalIndex - right.originalIndex
      );
    }
    return left.originalIndex - right.originalIndex;
  });
  const retained = new Set(
    eligible.slice(0, policy.topK).map((item) => item.claim),
  );

  return {
    ...summary,
    topics: summary.topics.flatMap((topic) => {
      const claims = topic.claims.filter((claim) => retained.has(claim));
      return claims.length === 0 ? [] : [{ ...topic, claims }];
    }),
  };
}

import type { EvidenceItem, Gold, ProjectedSummary, Score } from "./types.js";

type CandidateClaim = EvidenceItem & { thread: string };
type GoldEvidenceItem = EvidenceItem & { id: string; weight: number };
type Match = { candidateIndex: number; goldIndex: number };

export function emptyScore(validJson = false, schemaValid = false): Score {
  return {
    validJson,
    schemaValid,
    unknownEvidenceIds: 0,
    duplicateEvidenceIds: 0,
    topicCount: 0,
    claimCount: 0,
    decisionCount: 0,
    openQuestionCount: 0,
    majorThreadRecall: null,
    weightedClaimRecall: null,
    goldClaimPrecision: null,
    evidencePrecision: null,
    forbiddenRate: 0,
    falseOpenQuestionRate: null,
    noiseRetention: null,
    matchedClaimIds: [],
    matchedDecisionIds: [],
    matchedOpenQuestionIds: [],
    retainedThreadIds: [],
    triggeredForbiddenIds: [],
  };
}

export function scoreSummary(
  summary: ProjectedSummary,
  gold: Gold,
  validMessageIds: Set<number>,
): Score {
  const claims: CandidateClaim[] = summary.topics.flatMap((topic) =>
    topic.claims.map((claim) => ({ ...claim, thread: topic.id })),
  );
  const allItems = [...claims, ...summary.decisions, ...summary.openQuestions];
  const allEvidence = allItems.flatMap((item) => item.evidence);
  const unknownEvidenceIds = allEvidence.filter(
    (id) => !validMessageIds.has(id),
  ).length;
  const duplicateEvidenceIds = allItems.reduce(
    (total, item) => total + item.evidence.length - new Set(item.evidence).size,
    0,
  );

  const claimMatches = matchItems(claims, gold.claims, (candidate, target) => {
    const evidence = overlap(candidate.evidence, target.evidence);
    if (evidence === 0) return 0;
    return evidence * 10 + (sameId(candidate.thread, target.thread) ? 2 : 0);
  });
  const decisionMatches = matchItems(summary.decisions, gold.decisions);
  const questionMatches = matchItems(summary.openQuestions, gold.openQuestions);

  const matchedClaims = claimMatches.map(
    (match) => gold.claims[match.goldIndex]!,
  );
  const matchedClaimIds = matchedClaims.map((claim) => claim.id);
  const retainedThreadIds = [
    ...new Set([
      ...matchedClaims.map((claim) => claim.thread),
      ...summary.topics
        .filter((topic) => topic.claims.length > 0)
        .map((topic) => topic.id)
        .filter((id) => gold.threads.some((thread) => sameId(id, thread.id))),
    ]),
  ];
  const majorThreads = gold.threads.filter((thread) => thread.weight >= 3);
  const totalClaimWeight = gold.claims.reduce(
    (sum, claim) => sum + claim.weight,
    0,
  );

  const evidenceMatches = [
    ...claimMatches.map((match) => ({
      candidate: claims[match.candidateIndex]!,
      gold: gold.claims[match.goldIndex]!,
    })),
    ...decisionMatches.map((match) => ({
      candidate: summary.decisions[match.candidateIndex]!,
      gold: gold.decisions[match.goldIndex]!,
    })),
    ...questionMatches.map((match) => ({
      candidate: summary.openQuestions[match.candidateIndex]!,
      gold: gold.openQuestions[match.goldIndex]!,
    })),
  ];
  const supportingCitations = evidenceMatches.reduce(
    (sum, match) =>
      sum + overlap(match.candidate.evidence, match.gold.evidence),
    0,
  );

  const normalizedOutput = normalize(
    [...claims, ...summary.decisions].map((item) => item.text).join("\n"),
  );
  const triggeredForbiddenIds = gold.forbidden
    .filter((item) =>
      (item.patterns ?? [item.text]).some((pattern) =>
        normalizedOutput.includes(normalize(pattern)),
      ),
    )
    .map((item) => item.id);

  const noise = new Set(gold.noiseEvidence);
  const noisyClaims = claims.filter((claim) =>
    claim.evidence.some((id) => noise.has(id)),
  ).length;

  return {
    validJson: true,
    schemaValid: true,
    unknownEvidenceIds,
    duplicateEvidenceIds,
    topicCount: summary.topics.length,
    claimCount: claims.length,
    decisionCount: summary.decisions.length,
    openQuestionCount: summary.openQuestions.length,
    majorThreadRecall:
      majorThreads.length === 0
        ? null
        : majorThreads.filter((thread) => retainedThreadIds.includes(thread.id))
            .length / majorThreads.length,
    weightedClaimRecall:
      totalClaimWeight === 0
        ? null
        : matchedClaims.reduce((sum, claim) => sum + claim.weight, 0) /
          totalClaimWeight,
    goldClaimPrecision:
      claims.length === 0 ? null : claimMatches.length / claims.length,
    evidencePrecision:
      allEvidence.length === 0
        ? null
        : supportingCitations / allEvidence.length,
    forbiddenRate:
      triggeredForbiddenIds.length / Math.max(gold.forbidden.length, 1),
    falseOpenQuestionRate:
      summary.openQuestions.length === 0
        ? 0
        : (summary.openQuestions.length - questionMatches.length) /
          summary.openQuestions.length,
    noiseRetention: claims.length === 0 ? 0 : noisyClaims / claims.length,
    matchedClaimIds,
    matchedDecisionIds: decisionMatches.map(
      (match) => gold.decisions[match.goldIndex]!.id,
    ),
    matchedOpenQuestionIds: questionMatches.map(
      (match) => gold.openQuestions[match.goldIndex]!.id,
    ),
    retainedThreadIds,
    triggeredForbiddenIds,
  };
}

function matchItems<
  TCandidate extends EvidenceItem,
  TGold extends GoldEvidenceItem,
>(
  candidates: TCandidate[],
  gold: TGold[],
  score = (candidate: TCandidate, target: TGold) =>
    overlap(candidate.evidence, target.evidence),
): Match[] {
  const possible = candidates.flatMap((candidate, candidateIndex) =>
    gold
      .map((target, goldIndex) => ({
        candidateIndex,
        goldIndex,
        score: score(candidate, target),
      }))
      .filter((match) => match.score > 0),
  );
  possible.sort((a, b) => b.score - a.score);

  const usedCandidates = new Set<number>();
  const usedGold = new Set<number>();
  const matches: Match[] = [];
  for (const match of possible) {
    if (
      usedCandidates.has(match.candidateIndex) ||
      usedGold.has(match.goldIndex)
    ) {
      continue;
    }
    usedCandidates.add(match.candidateIndex);
    usedGold.add(match.goldIndex);
    matches.push(match);
  }
  return matches;
}

function overlap(left: number[], right: number[]): number {
  const rightSet = new Set(right);
  return new Set(left.filter((id) => rightSet.has(id))).size;
}

function sameId(left: string, right: string): boolean {
  return normalize(left) === normalize(right);
}

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("uk-UA")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

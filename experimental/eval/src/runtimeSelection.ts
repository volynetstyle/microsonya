import type { EvalMessage } from "./types.js";

export type CandidateClaim = {
  topic: string;
  text: string;
  evidence: number[];
};

export type RankBy =
  | "model-order"
  | "topic-support"
  | "reply-centrality"
  | "source-support"
  | "topic-reply"
  | "hybrid";

export type ClaimLimit =
  | { kind: "all" }
  | { kind: "top-k"; k: number }
  | { kind: "ratio"; ratio: number; min: number; max: number };

export type RuntimeSelectionPolicy = {
  dedupe: boolean;
  rankBy: RankBy;
  limit: ClaimLimit;
};

type RankedClaim = {
  claim: CandidateClaim;
  originalIndex: number;
  score: number;
};

export function selectCandidateClaims(
  claims: CandidateClaim[],
  messages: EvalMessage[],
  policy: RuntimeSelectionPolicy,
): CandidateClaim[] {
  const validIds = new Set(messages.map(({ id }) => id));
  const valid = claims
    .map((claim) => ({
      ...claim,
      evidence: [...new Set(claim.evidence)].filter((id) => validIds.has(id)),
    }))
    .filter((claim) => claim.evidence.length > 0);
  const candidates = policy.dedupe ? dedupeClaims(valid) : valid;
  const ranked = rankClaims(candidates, messages, policy.rankBy);
  const limit = claimLimit(ranked.length, policy.limit);
  return ranked.slice(0, limit).map(({ claim }) => claim);
}

export function dedupeClaims(claims: CandidateClaim[]): CandidateClaim[] {
  const retained: CandidateClaim[] = [];
  for (const claim of claims) {
    const duplicate = retained.some(
      (existing) =>
        normalize(existing.topic) === normalize(claim.topic) &&
        overlap(existing.evidence, claim.evidence) > 0 &&
        tokenJaccard(existing.text, claim.text) >= 0.6,
    );
    if (!duplicate) retained.push(claim);
  }
  return retained;
}

function rankClaims(
  claims: CandidateClaim[],
  messages: EvalMessage[],
  rankBy: RankBy,
): RankedClaim[] {
  const messageById = new Map(messages.map((message) => [message.id, message]));
  const children = new Map<number, number[]>();
  for (const message of messages) {
    if (message.replyTo == null) continue;
    const siblings = children.get(message.replyTo) ?? [];
    siblings.push(message.id);
    children.set(message.replyTo, siblings);
  }
  const descendants = descendantCounts(children);
  const branchSizes = replyBranchSizes(messages);
  const topicCounts = new Map<string, number>();
  for (const claim of claims) {
    const topic = normalize(claim.topic);
    topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1);
  }

  const raw = claims.map((claim, originalIndex) => {
    const evidenceMessages = claim.evidence
      .map((id) => messageById.get(id))
      .filter((message): message is EvalMessage => message !== undefined);
    return {
      claim,
      originalIndex,
      order: claims.length <= 1 ? 1 : 1 - originalIndex / (claims.length - 1),
      topic: Math.log1p(topicCounts.get(normalize(claim.topic)) ?? 0),
      directReplies: sum(
        claim.evidence.map((id) => children.get(id)?.length ?? 0),
      ),
      descendants: sum(claim.evidence.map((id) => descendants.get(id) ?? 0)),
      branchSize: Math.max(
        0,
        ...claim.evidence.map((id) => branchSizes.get(id) ?? 0),
      ),
      isReply: evidenceMessages.some((message) => message.replyTo != null)
        ? 1
        : 0,
      textLength: Math.max(
        0,
        ...evidenceMessages.map((message) => message.text?.length ?? 0),
      ),
    };
  });
  const normalized = {
    topic: normalizeFeature(raw.map(({ topic }) => topic)),
    directReplies: normalizeFeature(
      raw.map(({ directReplies }) => directReplies),
    ),
    descendants: normalizeFeature(raw.map(({ descendants }) => descendants)),
    branchSize: normalizeFeature(raw.map(({ branchSize }) => branchSize)),
    isReply: normalizeFeature(raw.map(({ isReply }) => isReply)),
    textLength: normalizeFeature(raw.map(({ textLength }) => textLength)),
  };

  const ranked = raw.map((item, index): RankedClaim => {
    const reply = average([
      normalized.directReplies[index]!,
      normalized.descendants[index]!,
      normalized.branchSize[index]!,
    ]);
    const source = average([
      reply,
      normalized.isReply[index]!,
      normalized.textLength[index]!,
    ]);
    const topic = normalized.topic[index]!;
    const scores: Record<RankBy, number> = {
      "model-order": item.order,
      "topic-support": topic,
      "reply-centrality": reply,
      "source-support": source,
      "topic-reply": average([topic, reply]),
      hybrid: average([item.order, topic, reply, source]),
    };
    return {
      claim: item.claim,
      originalIndex: item.originalIndex,
      score: scores[rankBy],
    };
  });
  return ranked.sort(
    (left, right) =>
      right.score - left.score || left.originalIndex - right.originalIndex,
  );
}

function claimLimit(total: number, limit: ClaimLimit): number {
  if (limit.kind === "all") return total;
  if (limit.kind === "top-k") return Math.min(total, limit.k);
  return Math.min(
    total,
    limit.max,
    Math.max(limit.min, Math.round(total * limit.ratio)),
  );
}

function descendantCounts(
  children: Map<number, number[]>,
): Map<number, number> {
  const cache = new Map<number, number>();
  const visit = (id: number, active: Set<number>): number => {
    const cached = cache.get(id);
    if (cached !== undefined) return cached;
    if (active.has(id)) return 0;
    const next = new Set(active).add(id);
    const count = sum(
      (children.get(id) ?? []).map((child) => 1 + visit(child, next)),
    );
    cache.set(id, count);
    return count;
  };
  for (const id of children.keys()) visit(id, new Set());
  return cache;
}

function replyBranchSizes(messages: EvalMessage[]): Map<number, number> {
  const neighbors = new Map<number, Set<number>>();
  for (const message of messages) neighbors.set(message.id, new Set());
  for (const message of messages) {
    if (message.replyTo == null || !neighbors.has(message.replyTo)) continue;
    neighbors.get(message.id)!.add(message.replyTo);
    neighbors.get(message.replyTo)!.add(message.id);
  }
  const sizes = new Map<number, number>();
  const seen = new Set<number>();
  for (const message of messages) {
    if (seen.has(message.id)) continue;
    const component: number[] = [];
    const queue = [message.id];
    seen.add(message.id);
    while (queue.length > 0) {
      const id = queue.shift()!;
      component.push(id);
      for (const next of neighbors.get(id) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    for (const id of component) sizes.set(id, component.length);
  }
  return sizes;
}

function normalizeFeature(values: number[]): number[] {
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  if (max === min) return values.map(() => 0);
  return values.map((value) => (value - min) / (max - min));
}

function tokenJaccard(left: string, right: string): number {
  const leftTokens = new Set(normalize(left).split(" ").filter(Boolean));
  const rightTokens = new Set(normalize(right).split(" ").filter(Boolean));
  const union = new Set([...leftTokens, ...rightTokens]);
  if (union.size === 0) return 0;
  return (
    [...leftTokens].filter((token) => rightTokens.has(token)).length /
    union.size
  );
}

function overlap(left: number[], right: number[]): number {
  const rightSet = new Set(right);
  return new Set(left.filter((id) => rightSet.has(id))).size;
}

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("uk-UA")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : sum(values) / values.length;
}

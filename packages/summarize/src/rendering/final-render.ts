import type { Claim, SegmentReconstruction } from "@microsonya/discourse";

export type SummaryEpisode = { topic: string; claims: Claim[] };

export function buildSummaryEpisodes(
  segments: readonly SegmentReconstruction[],
): SummaryEpisode[] {
  const deduplicated = new Map<string, Claim>();
  for (const claim of segments.flatMap(
    (segment) => segment.reconstruction.claims,
  )) {
    const key = `${normalize(claim.topic)}\u0000${normalize(claim.text)}`;
    const existing = deduplicated.get(key);
    deduplicated.set(
      key,
      existing
        ? {
            ...existing,
            evidence: [
              ...new Set([...existing.evidence, ...claim.evidence]),
            ].sort((a, b) => a - b),
          }
        : claim,
    );
  }

  const episodes = new Map<string, SummaryEpisode>();
  for (const claim of [...deduplicated.values()].sort(byEvidence)) {
    const key = normalize(claim.topic);
    const episode = episodes.get(key) ?? { topic: claim.topic, claims: [] };
    episode.claims.push(claim);
    episodes.set(key, episode);
  }
  return [...episodes.values()];
}

export function buildFinalRenderPrompt(
  episodes: readonly SummaryEpisode[],
): string {
  return [
    "Based on the evidence-backed claims below, summarize the conversation concisely in natural Ukrainian.",
    "Goal: minimum sufficient representation. Compress as much as possible without meaningful loss of content.",
    "Combine details from one episode into one coherent thought. Do not retell the message sequence when several messages can be expressed as one generalization.",
    "Do not create a lossy transcript made of sentences such as ‘Then...’, ‘After that...’, ‘They discussed...’, or ‘Finally...’. Move between meaningful episodes, not individual messages.",
    "Keep a concrete detail only when removing it would change the understanding of the event, position, or outcome. Compress or omit reactions, repetition, everyday tangents, and illustrative minutiae.",
    "Do not enumerate claims or use technical terms such as claim, evidence, or episode in the response.",
    "Do not add information or connections absent from the input claims. Do not infer causality from message order or turn an assumption into a confirmed fact.",
    "Preserve attribution, negation, uncertainty, comparisons, and numeric qualifiers exactly: for example, ‘highest rating’ does not mean ‘average rating’.",
    "When attribution is not unambiguous, use neutral wording such as ‘the chat mentioned’, rather than assigning words to a specific person.",
    "Recent meaningful events may be described more specifically, but must not displace important earlier context. Do not impose an artificial sentence limit.",
    "Поверни тільки JSON:",
    JSON.stringify(
      {
        title: "Коротка назва",
        summary: "Природний переказ розмови.",
      },
      null,
      2,
    ),
    "Episodes:",
    JSON.stringify({ episodes }, null, 2),
  ].join("\n\n");
}

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("uk-UA");
}

function byEvidence(left: Claim, right: Claim): number {
  return Math.min(...left.evidence) - Math.min(...right.evidence);
}

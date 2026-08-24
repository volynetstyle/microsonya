import { z } from "zod";
import type { BlindDataset, BlindRun } from "./blindCompaction.js";
import type { CompactionAction, CompactionFixture } from "./compaction.js";

export const compactionPredicatesSchema = z
  .object({
    durable: z.boolean(),
    essentialReferentsResolved: z.boolean(),
    visiblyIncomplete: z.boolean(),
    alreadyCompact: z.boolean(),
    primarilyReaction: z.boolean(),
    primarilyBanter: z.boolean(),
  })
  .strict();
export type CompactionPredicates = z.infer<typeof compactionPredicatesSchema>;
export const predicateNames = Object.keys(
  compactionPredicatesSchema.shape,
) as (keyof CompactionPredicates)[];

export const predicateGoldSchema = z
  .object({
    id: z.string().min(1),
    sourceDataset: z.string().min(1),
    extractorVersion: z.literal("predicate-v1"),
    families: z
      .array(
        z
          .object({
            id: z.string().min(1),
            predicates: compactionPredicatesSchema,
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
export type PredicateGold = z.infer<typeof predicateGoldSchema>;

export function projectPredicatesToAction(
  value: CompactionPredicates,
): CompactionAction {
  if (!value.durable && value.primarilyReaction) return "SKIP_REACTIONS";
  if (!value.durable && value.primarilyBanter) return "SKIP_BANTER";
  if (!value.durable) return "SKIP_NO_VALUE";
  if (!value.essentialReferentsResolved) return "DEFER_CONTEXT";
  if (value.visiblyIncomplete) return "DEFER_INCOMPLETE";
  if (value.alreadyCompact) return "DEFER_COMPACT";
  return "SUMMARIZE";
}

export function parseCompactionPredicates(
  raw: string,
): CompactionPredicates | null {
  try {
    return compactionPredicatesSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function buildPredicatePrompt(
  fixture: CompactionFixture[number],
): string {
  return [
    "Inspect this chat window and extract six semantic predicates.",
    "Return exactly one JSON object with all six boolean fields and no other fields or text:",
    '{"durable":true,"essentialReferentsResolved":true,"visiblyIncomplete":false,"alreadyCompact":false,"primarilyReaction":false,"primarilyBanter":false}',
    "Definitions:",
    "- durable: the window contains a concrete fact, decision, plan, request, result, argument, named problem, dependency, exception, or deadline worth preserving. Vague concern alone is not durable.",
    "- essentialReferentsResolved: every referent essential to preserving the durable information is identifiable inside this window. Set true when there is no durable information. Do not guess aliases, pronouns, proposals, tasks, objects, or deliverables.",
    "- visiblyIncomplete: the visible exchange explicitly leaves a result, verification, explanation, decision, answer, alternatives, or an unverified hypothesis pending.",
    "- alreadyCompact: all durable information is already a self-contained single decision, status, result, one action (optionally with a deadline), or compact invariant list. Set false when synthesis must combine dependent stages, sequencing, gates, thresholds, prerequisites, fallback, rollback, or separate lifecycle phases. This predicate is independent of unresolved context or incompleteness.",
    "- primarilyReaction: the entire non-durable window consists of greetings, acknowledgements, emotional reactions, laughter, emoji, or short responses.",
    "- primarilyBanter: the non-durable window is primarily jokes, wordplay, playful exaggeration, or social banter.",
    "Judge predicates independently. Surface length and number of facts do not determine alreadyCompact. Do not choose or emit a policy label.",
    "Messages:",
    ...fixture.messages.map(
      (message) => `[${message.time}] ${message.user}: ${message.text}`,
    ),
  ].join("\n");
}

export function validatePredicateGold(
  gold: PredicateGold,
  dataset: BlindDataset,
): void {
  const expectedIds = dataset.families.map((family) => family.id).sort();
  const actualIds = gold.families.map((family) => family.id).sort();
  if (JSON.stringify(expectedIds) !== JSON.stringify(actualIds))
    throw new Error(
      "Predicate gold must cover every blind family exactly once",
    );
  if (new Set(actualIds).size !== actualIds.length)
    throw new Error("Predicate gold contains duplicate families");
  for (const family of dataset.families) {
    const predicates = gold.families.find(
      (item) => item.id === family.id,
    )!.predicates;
    const projected = projectPredicatesToAction(predicates);
    if (projected !== family.expected)
      throw new Error(
        `Gold predicates for ${family.id} project to ${projected}, expected ${family.expected}`,
      );
  }
}

export type PredicateRun = {
  caseId: string;
  family: string;
  variant: string;
  domain: string;
  language: string;
  expected: CompactionAction;
  expectedPredicates: CompactionPredicates;
  predicates: CompactionPredicates | null;
  actual: CompactionAction | null;
  completed: boolean;
  schemaValid: boolean;
  predicateExact: boolean;
  correct: boolean;
  model: string;
  reasoning: BlindRun["reasoning"];
  seed: number;
  raw: string;
  thinking: string;
  contentLength: number;
  thinkingLength: number;
  usage: unknown;
};

export function toProjectedBlindRuns(runs: PredicateRun[]): BlindRun[] {
  return runs.map((run) => ({
    caseId: run.caseId,
    family: run.family,
    variant: run.variant,
    domain: run.domain,
    language: run.language,
    expected: run.expected,
    actual: run.actual,
    completed: run.completed,
    labelValid: run.schemaValid,
    correct: run.correct,
    promptVariant: "original",
    model: run.model,
    reasoning: run.reasoning,
    seed: run.seed,
    raw: run.raw,
    thinking: run.thinking,
    contentLength: run.contentLength,
    thinkingLength: run.thinkingLength,
    usage: run.usage,
  }));
}

export function summarizePredicates(runs: PredicateRun[]) {
  const valid = runs.filter((run) => run.schemaValid);
  const perPredicate = Object.fromEntries(
    predicateNames.map((name) => {
      let tp = 0;
      let fp = 0;
      let tn = 0;
      let fn = 0;
      for (const run of valid) {
        const expected = run.expectedPredicates[name];
        const actual = run.predicates![name];
        if (expected && actual) tp += 1;
        else if (!expected && actual) fp += 1;
        else if (!expected && !actual) tn += 1;
        else fn += 1;
      }
      return [
        name,
        { tp, fp, tn, fn, accuracy: divide(tp + tn, valid.length) },
      ];
    }),
  );
  return {
    total: runs.length,
    completionRate: divide(
      runs.filter((run) => run.completed).length,
      runs.length,
    ),
    schemaValidRate: divide(
      valid.length,
      runs.filter((run) => run.completed).length,
    ),
    predicateExactVectorAccuracy: divide(
      runs.filter((run) => run.predicateExact).length,
      runs.length,
    ),
    projectedEndToEndAccuracy: divide(
      runs.filter((run) => run.correct).length,
      runs.length,
    ),
    perPredicate,
  };
}

export function compareDirectAndPredicate(
  directRuns: BlindRun[],
  predicateRuns: PredicateRun[],
  dataset: BlindDataset,
  bootstrapSamples: number,
) {
  const directByCase = new Map(directRuns.map((run) => [run.caseId, run]));
  const rows = predicateRuns.map((predicate) => {
    const direct = directByCase.get(predicate.caseId);
    if (!direct)
      throw new Error(`Missing direct baseline for ${predicate.caseId}`);
    const predicateSemanticError = !predicate.predicateExact;
    let diagnostic:
      | "both-correct"
      | "predicate-correct-direct-wrong"
      | "direct-correct-predicate-wrong"
      | "both-wrong-semantic"
      | "both-wrong-with-correct-predicates";
    if (direct.correct && predicate.correct) diagnostic = "both-correct";
    else if (!direct.correct && predicate.correct)
      diagnostic = "predicate-correct-direct-wrong";
    else if (direct.correct) diagnostic = "direct-correct-predicate-wrong";
    else if (predicateSemanticError) diagnostic = "both-wrong-semantic";
    else diagnostic = "both-wrong-with-correct-predicates";
    return {
      caseId: predicate.caseId,
      family: predicate.family,
      directCorrect: direct.correct,
      predicateCorrect: predicate.correct,
      predicateExact: predicate.predicateExact,
      diagnostic,
    };
  });
  const clusters = dataset.sensitivityPairs.map((pair) => [
    pair.leftFamily,
    pair.rightFamily,
  ]);
  const rng = xorshift32(0x50ed1ca7);
  const deltas: number[] = [];
  for (let sample = 0; sample < bootstrapSamples; sample += 1) {
    const selected = [];
    for (let index = 0; index < clusters.length; index += 1)
      selected.push(clusters[Math.floor(rng() * clusters.length)]!);
    const sampled = selected.flatMap((families) =>
      rows.filter((row) => families.includes(row.family)),
    );
    deltas.push(
      divide(
        sampled.filter((row) => row.predicateCorrect).length,
        sampled.length,
      ) -
        divide(
          sampled.filter((row) => row.directCorrect).length,
          sampled.length,
        ),
    );
  }
  return {
    comparable: rows.length,
    directEndToEndAccuracy: divide(
      rows.filter((row) => row.directCorrect).length,
      rows.length,
    ),
    predicateProjectedEndToEndAccuracy: divide(
      rows.filter((row) => row.predicateCorrect).length,
      rows.length,
    ),
    pairedDelta: divide(
      rows.filter((row) => row.predicateCorrect).length -
        rows.filter((row) => row.directCorrect).length,
      rows.length,
    ),
    pairedClusterBootstrap95: interval(deltas),
    diagnosticCounts: Object.fromEntries(
      [...new Set(rows.map((row) => row.diagnostic))].map((name) => [
        name,
        rows.filter((row) => row.diagnostic === name).length,
      ]),
    ),
    cases: rows,
  };
}

function divide(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function interval(values: number[]): [number, number] {
  const sorted = [...values].sort((a, b) => a - b);
  return [
    sorted[Math.floor((sorted.length - 1) * 0.025)] ?? 0,
    sorted[Math.floor((sorted.length - 1) * 0.975)] ?? 0,
  ];
}

function xorshift32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

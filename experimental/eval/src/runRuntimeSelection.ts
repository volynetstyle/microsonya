import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { z } from "zod";
import {
  selectCandidateClaims,
  type CandidateClaim,
  type RankBy,
  type RuntimeSelectionPolicy,
} from "./runtimeSelection.js";
import {
  goldSchema,
  messageSchema,
  type EvalMessage,
  type Gold,
} from "./types.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const sourceRoot = path.join(packageRoot, "results", "claims-v6-120b");
const outputRoot = path.join(packageRoot, "results", "runtime-selection-v6");
const realCases = new Set([
  "real-ai-development",
  "real-ai-tools-interleaved",
  "real-fop-calculator",
  "real-job-search-abroad",
]);
const targetRecall = 0.9;

type CaseData = {
  name: string;
  messages: EvalMessage[];
  gold: Gold;
  claims: CandidateClaim[];
};

type CaseScore = {
  case: string;
  selectedClaims: number;
  candidateClaims: number;
  matchedClaims: number;
  matchedWeight: number;
  totalWeight: number;
  precision: number | null;
  recall: number | null;
  noiseClaims: number;
  noiseRate: number;
  evidencePrecision: number | null;
  citations: number;
  supportedCitations: number;
  retainedRatio: number;
};

type Aggregate = {
  cases: number;
  candidateClaims: number;
  selectedClaims: number;
  matchedClaims: number;
  weightedRecall: number | null;
  microPrecision: number | null;
  macroRecall: number | null;
  macroPrecision: number | null;
  noiseRate: number;
  evidencePrecision: number | null;
  retainedRatio: number;
};

const cases = await loadCases();
const policies = candidatePolicies();
const baselinePolicy: RuntimeSelectionPolicy = {
  dedupe: false,
  rankBy: "model-order",
  limit: { kind: "all" },
};

const baseline = aggregate(cases.map((item) => evaluate(item, baselinePolicy)));
const sweep = policies.map((policy) => ({
  policy,
  all: aggregate(cases.map((item) => evaluate(item, policy))),
  real: aggregate(
    cases
      .filter((item) => realCases.has(item.name))
      .map((item) => evaluate(item, policy)),
  ),
}));

const report = {
  experiment: "runtime-selection-v6",
  source: "frozen claims-v6-120b outputs",
  targetRecall,
  cases: cases.length,
  policies: policies.length,
  baseline: {
    all: baseline,
    real: aggregate(
      cases
        .filter((item) => realCases.has(item.name))
        .map((item) => evaluate(item, baselinePolicy)),
    ),
  },
  inSample: {
    all: bestAtRecall(
      sweep.map(({ policy, all }) => ({ policy, result: all })),
      targetRecall,
    ),
    real: bestAtRecall(
      sweep.map(({ policy, real }) => ({ policy, result: real })),
      targetRecall,
    ),
    frontiers: [0.95, 0.92, 0.9, 0.85].map((threshold) => ({
      threshold,
      all: bestAtRecall(
        sweep.map(({ policy, all }) => ({ policy, result: all })),
        threshold,
      ),
      real: bestAtRecall(
        sweep.map(({ policy, real }) => ({ policy, result: real })),
        threshold,
      ),
    })),
  },
  leaveOneCaseOut: leaveOneOut(cases, policies, targetRecall),
  leaveOneRealChatOut: leaveOneOut(
    cases.filter((item) => realCases.has(item.name)),
    policies,
    targetRecall,
  ),
};

await mkdir(outputRoot, { recursive: true });
await writeFile(
  path.join(outputRoot, "report.json"),
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8",
);
await writeFile(
  path.join(outputRoot, "frontier.csv"),
  sweepToCsv(sweep),
  "utf8",
);
console.log(JSON.stringify(report, null, 2));

function evaluate(item: CaseData, policy: RuntimeSelectionPolicy): CaseScore {
  const selected = selectCandidateClaims(item.claims, item.messages, policy);
  const matches = matchClaims(selected, item.gold.claims);
  const matchedGold = matches.map(
    ({ goldIndex }) => item.gold.claims[goldIndex]!,
  );
  const matchedWeight = matchedGold.reduce(
    (sum, claim) => sum + claim.weight,
    0,
  );
  const totalWeight = item.gold.claims.reduce(
    (sum, claim) => sum + claim.weight,
    0,
  );
  const noise = new Set(item.gold.noiseEvidence);
  const noiseClaims = selected.filter((claim) =>
    claim.evidence.some((id) => noise.has(id)),
  ).length;
  const citations = selected.reduce(
    (sum, claim) => sum + claim.evidence.length,
    0,
  );
  const supportedCitations = matches.reduce((sum, match) => {
    const candidate = selected[match.candidateIndex]!;
    const gold = item.gold.claims[match.goldIndex]!;
    return sum + overlap(candidate.evidence, gold.evidence);
  }, 0);
  return {
    case: item.name,
    selectedClaims: selected.length,
    candidateClaims: item.claims.length,
    matchedClaims: matches.length,
    matchedWeight,
    totalWeight,
    precision: selected.length === 0 ? null : matches.length / selected.length,
    recall: totalWeight === 0 ? null : matchedWeight / totalWeight,
    noiseClaims,
    noiseRate: selected.length === 0 ? 0 : noiseClaims / selected.length,
    evidencePrecision: citations === 0 ? null : supportedCitations / citations,
    citations,
    supportedCitations,
    retainedRatio:
      item.claims.length === 0 ? 0 : selected.length / item.claims.length,
  };
}

function aggregate(scores: CaseScore[]): Aggregate {
  const selectedClaims = sum(
    scores.map(({ selectedClaims }) => selectedClaims),
  );
  const candidateClaims = sum(
    scores.map(({ candidateClaims }) => candidateClaims),
  );
  const matchedClaims = sum(scores.map(({ matchedClaims }) => matchedClaims));
  const totalWeight = sum(scores.map(({ totalWeight }) => totalWeight));
  const matchedWeight = sum(scores.map(({ matchedWeight }) => matchedWeight));
  const noiseClaims = sum(scores.map(({ noiseClaims }) => noiseClaims));
  const citations = sum(scores.map((score) => score.citations));
  const supportedCitations = sum(
    scores.map((score) => score.supportedCitations),
  );
  return {
    cases: scores.length,
    candidateClaims,
    selectedClaims,
    matchedClaims,
    weightedRecall: totalWeight === 0 ? null : matchedWeight / totalWeight,
    microPrecision:
      selectedClaims === 0 ? null : matchedClaims / selectedClaims,
    macroRecall: mean(scores.map(({ recall }) => recall)),
    macroPrecision: mean(scores.map(({ precision }) => precision)),
    noiseRate: selectedClaims === 0 ? 0 : noiseClaims / selectedClaims,
    evidencePrecision: citations === 0 ? null : supportedCitations / citations,
    retainedRatio: candidateClaims === 0 ? 0 : selectedClaims / candidateClaims,
  };
}

function leaveOneOut(
  data: CaseData[],
  candidatePolicies: RuntimeSelectionPolicy[],
  recallFloor: number,
) {
  const rows = data.map((heldOut, index) => {
    const train = data.filter((_, itemIndex) => itemIndex !== index);
    const selected = choosePolicy(
      candidatePolicies.map((policy) => ({
        policy,
        result: aggregate(train.map((item) => evaluate(item, policy))),
      })),
      recallFloor,
    );
    return {
      case: heldOut.name,
      policy: selected.policy,
      train: selected.result,
      test: evaluate(heldOut, selected.policy),
    };
  });
  return {
    result: aggregate(rows.map(({ test }) => test)),
    selections: rows.map(({ case: caseName, policy, train, test }) => ({
      case: caseName,
      policy,
      trainRecall: train.weightedRecall,
      testRecall: test.recall,
      testPrecision: test.precision,
      testNoise: test.noiseRate,
      retainedClaims: test.selectedClaims,
    })),
  };
}

function choosePolicy<
  T extends { policy: RuntimeSelectionPolicy; result: Aggregate },
>(rows: T[], recallFloor: number): T {
  const eligible = rows.filter(
    ({ result }) => (result.weightedRecall ?? 0) >= recallFloor,
  );
  if (eligible.length === 0) {
    return (
      rows.find(
        ({ policy }) =>
          !policy.dedupe &&
          policy.rankBy === "model-order" &&
          policy.limit.kind === "all",
      ) ?? rows[0]!
    );
  }
  return [...eligible].sort(comparePolicyRows)[0]!;
}

function bestAtRecall<
  T extends { policy: RuntimeSelectionPolicy; result: Aggregate },
>(rows: T[], threshold: number): T | null {
  const eligible = rows.filter(
    ({ result }) => (result.weightedRecall ?? 0) >= threshold,
  );
  return eligible.length === 0
    ? null
    : [...eligible].sort(comparePolicyRows)[0]!;
}

function comparePolicyRows(
  left: { result: Aggregate },
  right: { result: Aggregate },
): number {
  return (
    (right.result.microPrecision ?? 0) - (left.result.microPrecision ?? 0) ||
    left.result.noiseRate - right.result.noiseRate ||
    left.result.selectedClaims - right.result.selectedClaims ||
    (right.result.weightedRecall ?? 0) - (left.result.weightedRecall ?? 0)
  );
}

function candidatePolicies(): RuntimeSelectionPolicy[] {
  const ranks: RankBy[] = [
    "model-order",
    "topic-support",
    "reply-centrality",
    "source-support",
    "topic-reply",
    "hybrid",
  ];
  return ranks.flatMap((rankBy) =>
    [false, true].flatMap((dedupe) => [
      {
        dedupe,
        rankBy,
        limit: { kind: "all" },
      } satisfies RuntimeSelectionPolicy,
      ...[4, 6, 8, 10, 12, 14, 16, 20].map(
        (k): RuntimeSelectionPolicy => ({
          dedupe,
          rankBy,
          limit: { kind: "top-k", k },
        }),
      ),
      ...[0.4, 0.5, 0.6, 0.7, 0.8, 0.9].map(
        (ratio): RuntimeSelectionPolicy => ({
          dedupe,
          rankBy,
          limit: { kind: "ratio", ratio, min: 2, max: 20 },
        }),
      ),
    ]),
  );
}

function matchClaims(
  candidates: CandidateClaim[],
  gold: Gold["claims"],
): Array<{ candidateIndex: number; goldIndex: number; score: number }> {
  const possible = candidates.flatMap((candidate, candidateIndex) =>
    gold
      .map((target, goldIndex) => ({
        candidateIndex,
        goldIndex,
        score: overlap(candidate.evidence, target.evidence),
      }))
      .filter(({ score }) => score > 0),
  );
  possible.sort((left, right) => right.score - left.score);
  const candidatesUsed = new Set<number>();
  const goldUsed = new Set<number>();
  return possible.filter(({ candidateIndex, goldIndex }) => {
    if (candidatesUsed.has(candidateIndex) || goldUsed.has(goldIndex))
      return false;
    candidatesUsed.add(candidateIndex);
    goldUsed.add(goldIndex);
    return true;
  });
}

function overlap(left: number[], right: number[]): number {
  const rightSet = new Set(right);
  return new Set(left.filter((id) => rightSet.has(id))).size;
}

function sweepToCsv(
  rows: Array<{
    policy: RuntimeSelectionPolicy;
    all: Aggregate;
    real: Aggregate;
  }>,
): string {
  const header = [
    "dedupe",
    "rankBy",
    "limit",
    "scope",
    "weightedRecall",
    "microPrecision",
    "noiseRate",
    "evidencePrecision",
    "selectedClaims",
    "retainedRatio",
  ];
  const body = rows.flatMap(({ policy, all, real }) =>
    (["all", "real"] as const).map((scope) => {
      const result = scope === "all" ? all : real;
      return [
        policy.dedupe,
        policy.rankBy,
        JSON.stringify(policy.limit),
        scope,
        result.weightedRecall,
        result.microPrecision,
        result.noiseRate,
        result.evidencePrecision,
        result.selectedClaims,
        result.retainedRatio,
      ];
    }),
  );
  return (
    [header, ...body].map((row) => row.map(csvCell).join(",")).join("\n") + "\n"
  );
}

function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function loadCases(): Promise<CaseData[]> {
  const files = (await import("node:fs/promises")).readdir(sourceRoot, {
    withFileTypes: true,
  });
  const entries = await files;
  const names = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name.replace(/\.json$/, ""))
    .filter((name) => name !== "comparison")
    .sort();
  return Promise.all(
    names.map(async (name) => {
      const stored = z
        .object({
          parsed: z
            .object({
              claims: z.array(
                z.object({
                  topic: z.string(),
                  text: z.string(),
                  evidence: z.array(z.number().int()),
                }),
              ),
            })
            .nullable(),
          raw: z.string(),
        })
        .passthrough()
        .parse(await readJson(path.join(sourceRoot, `${name}.json`)));
      const raw = JSON.parse(stored.raw) as { claims?: CandidateClaim[] };
      const claims = stored.parsed?.claims ?? raw.claims ?? [];
      const caseRoot = path.join(packageRoot, "cases", name);
      return {
        name,
        claims,
        messages: z
          .array(messageSchema)
          .parse(await readJson(path.join(caseRoot, "messages.json"))),
        gold: goldSchema.parse(
          await readJson(path.join(caseRoot, "gold.json")),
        ),
      };
    }),
  );
}

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, "utf8"));
}

function mean(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length === 0 ? null : sum(present) / present.length;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

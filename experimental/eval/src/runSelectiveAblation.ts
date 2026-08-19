import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { scoreSummary } from "./score.js";
import { selectSummaryClaims, type ClaimSelectionPolicy } from "./selective.js";
import {
  goldSchema,
  messageSchema,
  type EvalMessage,
  type Gold,
  type Score,
  type StoredRun,
} from "./types.js";
import { z } from "zod";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const resultsRoot = path.join(packageRoot, "results", "model-screening-v1");
const model = process.argv[2] ?? "deepseek-v4-pro:preview";
const runs = await loadDirectRuns(resultsRoot, model);
const cases = await Promise.all(
  runs.map(async (run) => {
    const fixture = await loadCase(run.case);
    return { run, ...fixture };
  }),
);
const policies = candidatePolicies();
const baseline = aggregate(cases.map((item) => evaluate(item, null)));
const globalRows = policies.map((policy) => ({
  policy,
  result: aggregate(cases.map((item) => evaluate(item, policy))),
}));
const globallyBest = choose(globalRows);

const heldOut = cases.map((test, index) => {
  const train = cases.filter((_, itemIndex) => itemIndex !== index);
  const selected = choose(
    policies.map((policy) => ({
      policy,
      result: aggregate(train.map((item) => evaluate(item, policy))),
    })),
  ).policy;
  return {
    case: test.run.case,
    policy: selected,
    scored: evaluate(test, selected),
  };
});

console.log(
  JSON.stringify(
    {
      model,
      cases: cases.length,
      baseline,
      optimisticInSample: globallyBest,
      precisionAtRecall: [0.98, 0.95, 0.9, 0.8, 0.7].map((threshold) => ({
        threshold,
        best: bestAtRecall(globalRows, threshold),
      })),
      leaveOneCaseOut: {
        result: aggregate(heldOut.map((item) => item.scored)),
        selections: heldOut.map(({ case: caseName, policy }) => ({
          case: caseName,
          policy,
        })),
      },
    },
    null,
    2,
  ),
);

type CaseData = { run: StoredRun; messages: EvalMessage[]; gold: Gold };
type Evaluated = { score: Score; gold: Gold; citations: number };

function evaluate(
  item: CaseData,
  policy: ClaimSelectionPolicy | null,
): Evaluated {
  const summary = policy
    ? selectSummaryClaims(item.run.parsed!, item.messages, policy)
    : item.run.parsed!;
  return {
    score: scoreSummary(
      summary,
      item.gold,
      new Set(item.messages.map((message) => message.id)),
    ),
    gold: item.gold,
    citations: [
      ...summary.topics.flatMap((topic) => topic.claims),
      ...summary.decisions,
      ...summary.openQuestions,
    ].reduce((sum, candidate) => sum + candidate.evidence.length, 0),
  };
}

function aggregate(items: Evaluated[]) {
  const predicted = items.reduce((sum, item) => sum + item.score.claimCount, 0);
  const matched = items.reduce(
    (sum, item) => sum + item.score.matchedClaimIds.length,
    0,
  );
  const totalWeight = items.reduce(
    (sum, item) =>
      sum +
      item.gold.claims.reduce((subtotal, claim) => subtotal + claim.weight, 0),
    0,
  );
  const matchedWeight = items.reduce((sum, item) => {
    const ids = new Set(item.score.matchedClaimIds);
    return (
      sum +
      item.gold.claims
        .filter((claim) => ids.has(claim.id))
        .reduce((subtotal, claim) => subtotal + claim.weight, 0)
    );
  }, 0);
  const citations = items.reduce((sum, item) => sum + item.citations, 0);
  const supportedCitations = items.reduce(
    (sum, item) => sum + (item.score.evidencePrecision ?? 0) * item.citations,
    0,
  );
  return {
    predictedClaims: predicted,
    matchedClaims: matched,
    weightedRecall: totalWeight === 0 ? null : matchedWeight / totalWeight,
    macroRecall: mean(items.map((item) => item.score.weightedClaimRecall)),
    microPrecision: predicted === 0 ? null : matched / predicted,
    macroPrecision: mean(items.map((item) => item.score.goldClaimPrecision)),
    evidencePrecision: citations === 0 ? null : supportedCitations / citations,
  };
}

function mean(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length === 0
    ? null
    : present.reduce((sum, value) => sum + value, 0) / present.length;
}

function choose<
  T extends {
    policy: ClaimSelectionPolicy;
    result: ReturnType<typeof aggregate>;
  },
>(rows: T[]): T {
  const eligible = rows.filter(
    (row) => (row.result.weightedRecall ?? 0) >= 0.95,
  );
  const pool = eligible.length > 0 ? eligible : rows;
  return [...pool].sort(
    (left, right) =>
      (right.result.microPrecision ?? 0) - (left.result.microPrecision ?? 0) ||
      (right.result.weightedRecall ?? 0) - (left.result.weightedRecall ?? 0) ||
      left.result.predictedClaims - right.result.predictedClaims,
  )[0]!;
}

function bestAtRecall<
  T extends {
    policy: ClaimSelectionPolicy;
    result: ReturnType<typeof aggregate>;
  },
>(rows: T[], threshold: number): T | null {
  const eligible = rows.filter(
    (row) => (row.result.weightedRecall ?? 0) >= threshold,
  );
  if (eligible.length === 0) return null;
  return [...eligible].sort(
    (left, right) =>
      (right.result.microPrecision ?? 0) - (left.result.microPrecision ?? 0) ||
      (right.result.weightedRecall ?? 0) - (left.result.weightedRecall ?? 0),
  )[0]!;
}

function candidatePolicies(): ClaimSelectionPolicy[] {
  return ["model-order", "evidence-count", "reply-centrality"].flatMap(
    (rankBy) =>
      [1, 2].flatMap((minEvidence) =>
        [2, 3, 4, 5, 6, 8, 12, Number.MAX_SAFE_INTEGER].map((topK) => ({
          rankBy,
          minEvidence,
          topK,
        })),
      ),
  ) as ClaimSelectionPolicy[];
}

async function loadDirectRuns(
  root: string,
  selectedModel: string,
): Promise<StoredRun[]> {
  const files = await walk(root);
  const runs = await Promise.all(
    files
      .filter((file) => file.endsWith("seed-1.json"))
      .map(
        async (file) => JSON.parse(await readFile(file, "utf8")) as StoredRun,
      ),
  );
  return runs.filter(
    (run) =>
      run.model === selectedModel &&
      run.pipeline === "direct" &&
      run.status === "ok",
  );
}

async function walk(root: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(root, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) => {
        const target = path.join(root, entry.name);
        return entry.isDirectory() ? walk(target) : [target];
      }),
    )
  ).flat();
}

async function loadCase(
  caseName: string,
): Promise<{ messages: EvalMessage[]; gold: Gold }> {
  const root = path.join(packageRoot, "cases", caseName);
  return {
    messages: z
      .array(messageSchema)
      .parse(
        JSON.parse(await readFile(path.join(root, "messages.json"), "utf8")),
      ),
    gold: goldSchema.parse(
      JSON.parse(await readFile(path.join(root, "gold.json"), "utf8")),
    ),
  };
}

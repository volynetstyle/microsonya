import type { Experiment, Score, StoredRun } from "./types.js";

const deltaMetrics = [
  "majorThreadRecall",
  "weightedClaimRecall",
  "goldClaimPrecision",
  "evidencePrecision",
  "forbiddenRate",
  "falseOpenQuestionRate",
  "noiseRetention",
] as const;

type DeltaMetric = (typeof deltaMetrics)[number];
type PairDimension =
  | "transformation"
  | "transformation-vs-replay"
  | "representation"
  | "pipeline";

export type PairedRow = {
  dimension: PairDimension;
  baseline: string;
  target: string;
  model: string;
  pipeline: string;
  representation: string;
  transformation: string;
  reasoning: string;
  measure: DeltaMetric | "claimSetJaccard" | "threadSetJaccard";
  statistic: "target-minus-baseline" | "invariance";
  nCases: number;
  nPairs: number;
  estimate: number;
  ciLow: number;
  ciHigh: number;
  wins: number;
  ties: number;
  losses: number;
};

type RunPair = { baseline: StoredRun; target: StoredRun };

export function pairedComparisons(
  runs: StoredRun[],
  experiment: Experiment,
): PairedRow[] {
  return [
    ...transformationComparisons(runs, experiment),
    ...representationComparisons(runs, experiment),
    ...pipelineComparisons(runs, experiment),
  ];
}

export function pairedRowsToCsv(rows: PairedRow[]): string {
  const headers: Array<keyof PairedRow> = [
    "dimension",
    "baseline",
    "target",
    "model",
    "pipeline",
    "representation",
    "transformation",
    "reasoning",
    "measure",
    "statistic",
    "nCases",
    "nPairs",
    "estimate",
    "ciLow",
    "ciHigh",
    "wins",
    "ties",
    "losses",
  ];
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((key) => csv(row[key])).join(",")),
  ]
    .join("\n")
    .concat("\n");
}

function transformationComparisons(
  runs: StoredRun[],
  experiment: Experiment,
): PairedRow[] {
  const baseline = experiment.transformations.includes("identity")
    ? "identity"
    : experiment.transformations[0]!;
  const rows: PairedRow[] = [];
  for (const target of experiment.transformations.filter(
    (item) => item !== baseline,
  )) {
    for (const model of experiment.models) {
      for (const pipeline of experiment.pipelines) {
        for (const representation of experiment.representations) {
          for (const reasoning of experiment.reasoning) {
            const scoped = runs.filter(
              (run) =>
                run.model === model &&
                pipelineOf(run) === pipeline &&
                run.representation === representation &&
                run.reasoning === reasoning,
            );
            rows.push(
              ...compare(
                "transformation",
                baseline,
                target,
                scoped.filter((run) => transformationOf(run) === baseline),
                scoped.filter((run) => transformationOf(run) === target),
                {
                  model,
                  pipeline,
                  representation,
                  transformation: "*",
                  reasoning,
                },
              ),
            );
          }
        }
      }
    }
  }
  if (experiment.transformations.includes("identity-replay")) {
    for (const target of experiment.transformations.filter(
      (item) => item !== "identity" && item !== "identity-replay",
    )) {
      for (const model of experiment.models) {
        for (const pipeline of experiment.pipelines) {
          for (const representation of experiment.representations) {
            for (const reasoning of experiment.reasoning) {
              const scoped = runs.filter(
                (run) =>
                  run.model === model &&
                  pipelineOf(run) === pipeline &&
                  run.representation === representation &&
                  run.reasoning === reasoning,
              );
              rows.push(
                ...compare(
                  "transformation-vs-replay",
                  "identity-replay",
                  target,
                  scoped.filter(
                    (run) => transformationOf(run) === "identity-replay",
                  ),
                  scoped.filter((run) => transformationOf(run) === target),
                  {
                    model,
                    pipeline,
                    representation,
                    transformation: "*",
                    reasoning,
                  },
                ),
              );
            }
          }
        }
      }
    }
  }
  return rows;
}

function representationComparisons(
  runs: StoredRun[],
  experiment: Experiment,
): PairedRow[] {
  const baseline = experiment.representations[0]!;
  const rows: PairedRow[] = [];
  for (const target of experiment.representations.slice(1)) {
    for (const model of experiment.models) {
      for (const pipeline of experiment.pipelines) {
        for (const transformation of experiment.transformations) {
          for (const reasoning of experiment.reasoning) {
            const scoped = runs.filter(
              (run) =>
                run.model === model &&
                pipelineOf(run) === pipeline &&
                transformationOf(run) === transformation &&
                run.reasoning === reasoning,
            );
            rows.push(
              ...compare(
                "representation",
                baseline,
                target,
                scoped.filter((run) => run.representation === baseline),
                scoped.filter((run) => run.representation === target),
                {
                  model,
                  pipeline,
                  representation: "*",
                  transformation,
                  reasoning,
                },
              ),
            );
          }
        }
      }
    }
  }
  return rows;
}

function pipelineComparisons(
  runs: StoredRun[],
  experiment: Experiment,
): PairedRow[] {
  const baseline = experiment.pipelines[0]!;
  const rows: PairedRow[] = [];
  for (const target of experiment.pipelines.slice(1)) {
    for (const model of experiment.models) {
      for (const representation of experiment.representations) {
        for (const transformation of experiment.transformations) {
          for (const reasoning of experiment.reasoning) {
            const scoped = runs.filter(
              (run) =>
                run.model === model &&
                run.representation === representation &&
                transformationOf(run) === transformation &&
                run.reasoning === reasoning,
            );
            rows.push(
              ...compare(
                "pipeline",
                baseline,
                target,
                scoped.filter((run) => pipelineOf(run) === baseline),
                scoped.filter((run) => pipelineOf(run) === target),
                {
                  model,
                  pipeline: "*",
                  representation,
                  transformation,
                  reasoning,
                },
              ),
            );
          }
        }
      }
    }
  }
  return rows;
}

function compare(
  dimension: PairDimension,
  baselineName: string,
  targetName: string,
  baselineRuns: StoredRun[],
  targetRuns: StoredRun[],
  scope: Pick<
    PairedRow,
    "model" | "pipeline" | "representation" | "transformation" | "reasoning"
  >,
): PairedRow[] {
  const targets = new Map(
    targetRuns.map((run) => [`${run.case}\0${run.seed}`, run]),
  );
  const pairs = baselineRuns
    .filter((run) => run.status === "ok")
    .map((baseline) => ({
      baseline,
      target: targets.get(`${baseline.case}\0${baseline.seed}`),
    }))
    .filter(
      (pair): pair is RunPair =>
        pair.target !== undefined && pair.target.status === "ok",
    );
  if (pairs.length === 0) return [];

  const rows: PairedRow[] = [];
  for (const measure of deltaMetrics) {
    const observations = pairs.flatMap((pair) => {
      const baseline = pair.baseline.metrics[measure];
      const target = pair.target.metrics[measure];
      return baseline === null || target === null
        ? []
        : [{ caseName: pair.baseline.case, value: target - baseline }];
    });
    if (observations.length > 0) {
      rows.push(
        summarize(
          dimension,
          baselineName,
          targetName,
          measure,
          "target-minus-baseline",
          observations,
          scope,
        ),
      );
    }
  }

  for (const [measure, select] of [
    ["claimSetJaccard", (score: Score) => score.matchedClaimIds],
    ["threadSetJaccard", (score: Score) => score.retainedThreadIds],
  ] as const) {
    rows.push(
      summarize(
        dimension,
        baselineName,
        targetName,
        measure,
        "invariance",
        pairs.map((pair) => ({
          caseName: pair.baseline.case,
          value: jaccard(
            select(pair.baseline.metrics),
            select(pair.target.metrics),
          ),
        })),
        scope,
      ),
    );
  }
  return rows;
}

function summarize(
  dimension: PairDimension,
  baseline: string,
  target: string,
  measure: PairedRow["measure"],
  statistic: PairedRow["statistic"],
  observations: Array<{ caseName: string; value: number }>,
  scope: Pick<
    PairedRow,
    "model" | "pipeline" | "representation" | "transformation" | "reasoning"
  >,
): PairedRow {
  const grouped = new Map<string, number[]>();
  for (const observation of observations) {
    grouped.set(observation.caseName, [
      ...(grouped.get(observation.caseName) ?? []),
      observation.value,
    ]);
  }
  const caseValues = [...grouped.values()].map(mean);
  const [ciLow, ciHigh] = bootstrapCaseMean(caseValues);
  return {
    dimension,
    baseline,
    target,
    ...scope,
    measure,
    statistic,
    nCases: caseValues.length,
    nPairs: observations.length,
    estimate: mean(caseValues),
    ciLow,
    ciHigh,
    wins: observations.filter((item) => item.value > 1e-12).length,
    ties: observations.filter((item) => Math.abs(item.value) <= 1e-12).length,
    losses: observations.filter((item) => item.value < -1e-12).length,
  };
}

function bootstrapCaseMean(
  values: number[],
  iterations = 10_000,
): [number, number] {
  if (values.length === 1) return [values[0]!, values[0]!];
  const random = mulberry32(0x51a7e);
  const samples = Array.from({ length: iterations }, () => {
    const drawn = Array.from(
      { length: values.length },
      () => values[Math.floor(random() * values.length)]!,
    );
    return mean(drawn);
  }).sort((left, right) => left - right);
  return [percentile(samples, 0.025), percentile(samples, 0.975)];
}

function jaccard(left: string[], right: string[]): number {
  const a = new Set(left);
  const b = new Set(right);
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 1;
  return [...a].filter((item) => b.has(item)).length / union.size;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(sorted: number[], quantile: number): number {
  return sorted[Math.floor((sorted.length - 1) * quantile)]!;
}

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function transformationOf(run: StoredRun): string {
  return run.transformation ?? "identity";
}

function pipelineOf(run: StoredRun): string {
  return run.pipeline ?? "deterministic-shell";
}

function csv(value: unknown): string {
  if (typeof value === "number")
    return Number.isInteger(value) ? String(value) : value.toFixed(6);
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

import type { StoredRun } from "./types.js";

export type FrontierRow = {
  model: string;
  pipeline: string;
  representation: string;
  transformation: string;
  reasoning: string;
  n: number;
  okRuns: number;
  okRate: number;
  recallMean: number | null;
  goldClaimPrecisionMean: number | null;
  evidencePrecisionMean: number | null;
  falseOpenQuestionRateMean: number | null;
  noiseRetentionMean: number | null;
  promptTokensMean: number | null;
  thinkingTokensMean: number | null;
  finalTokensMean: number | null;
  generatedTokensMean: number | null;
  reasoningShareMean: number | null;
  latencyMsMean: number | null;
};

export function frontierRows(runs: StoredRun[]): FrontierRow[] {
  const groups = new Map<string, StoredRun[]>();
  for (const run of runs) {
    const key = JSON.stringify([
      run.model,
      run.pipeline ?? "deterministic-shell",
      run.representation,
      run.transformation ?? "identity",
      run.reasoning,
    ]);
    groups.set(key, [...(groups.get(key) ?? []), run]);
  }
  return [...groups.values()].map((group) => {
    const first = group[0]!;
    const ok = group.filter((run) => run.status === "ok");
    const thinking = numbers(
      group.map((run) => run.usage.thinkingTextTokenCount),
    );
    const final = numbers(group.map((run) => run.usage.finalTextTokenCount));
    const reasoningShares = group.flatMap((run) => {
      const thinkingTokens = run.usage.thinkingTextTokenCount;
      const finalTokens = run.usage.finalTextTokenCount;
      if (thinkingTokens === undefined || finalTokens === undefined) return [];
      return [thinkingTokens / (thinkingTokens + finalTokens)];
    });
    return {
      model: first.model,
      pipeline: first.pipeline ?? "deterministic-shell",
      representation: first.representation,
      transformation: first.transformation ?? "identity",
      reasoning: first.reasoning,
      n: group.length,
      okRuns: ok.length,
      okRate: ok.length / group.length,
      recallMean: mean(
        numbers(ok.map((run) => run.metrics.weightedClaimRecall)),
      ),
      goldClaimPrecisionMean: mean(
        numbers(ok.map((run) => run.metrics.goldClaimPrecision)),
      ),
      evidencePrecisionMean: mean(
        numbers(ok.map((run) => run.metrics.evidencePrecision)),
      ),
      falseOpenQuestionRateMean: mean(
        numbers(ok.map((run) => run.metrics.falseOpenQuestionRate)),
      ),
      noiseRetentionMean: mean(
        numbers(ok.map((run) => run.metrics.noiseRetention)),
      ),
      promptTokensMean: mean(
        numbers(group.map((run) => run.usage.promptEvalCount)),
      ),
      thinkingTokensMean: mean(thinking),
      finalTokensMean: mean(final),
      generatedTokensMean: mean(
        numbers(group.map((run) => run.usage.evalCount)),
      ),
      reasoningShareMean: mean(reasoningShares),
      latencyMsMean: mean(numbers(group.map((run) => run.usage.durationMs))),
    };
  });
}

export function frontierToCsv(rows: FrontierRow[]): string {
  const headers: Array<keyof FrontierRow> = [
    "model",
    "pipeline",
    "representation",
    "transformation",
    "reasoning",
    "n",
    "okRuns",
    "okRate",
    "recallMean",
    "goldClaimPrecisionMean",
    "evidencePrecisionMean",
    "falseOpenQuestionRateMean",
    "noiseRetentionMean",
    "promptTokensMean",
    "thinkingTokensMean",
    "finalTokensMean",
    "generatedTokensMean",
    "reasoningShareMean",
    "latencyMsMean",
  ];
  return csv(headers, rows);
}

export function reasoningPairedToCsv(runs: StoredRun[]): string {
  const headers = [
    "baseline",
    "target",
    "measure",
    "nCases",
    "nPairs",
    "delta",
    "ciLow",
    "ciHigh",
  ];
  const modes = [...new Set(runs.map((run) => run.reasoning))];
  const baselineMode = modes.includes("low") ? "low" : modes[0]!;
  const baseline = new Map(
    runs
      .filter((run) => run.reasoning === baselineMode)
      .map((run) => [pairKey(run), run]),
  );
  const rows = modes
    .filter((mode) => mode !== baselineMode)
    .flatMap((target) => {
      const pairs = runs
        .filter((run) => run.reasoning === target)
        .flatMap((run) => {
          const base = baseline.get(pairKey(run));
          if (!base || base.status !== "ok" || run.status !== "ok") return [];
          return [{ caseName: run.case, baseline: base, target: run }];
        });
      if (pairs.length === 0) return [];
      const measures = [
        [
          "weightedClaimRecall",
          (run: StoredRun) => run.metrics.weightedClaimRecall,
        ],
        [
          "goldClaimPrecision",
          (run: StoredRun) => run.metrics.goldClaimPrecision,
        ],
        [
          "evidencePrecision",
          (run: StoredRun) => run.metrics.evidencePrecision,
        ],
        ["forbiddenRate", (run: StoredRun) => run.metrics.forbiddenRate],
        [
          "falseOpenQuestionRate",
          (run: StoredRun) => run.metrics.falseOpenQuestionRate,
        ],
        ["noiseRetention", (run: StoredRun) => run.metrics.noiseRetention],
        [
          "thinkingTokens",
          (run: StoredRun) => run.usage.thinkingTextTokenCount,
        ],
        ["finalTokens", (run: StoredRun) => run.usage.finalTextTokenCount],
        ["latencyMs", (run: StoredRun) => run.usage.durationMs],
      ] as const;
      return measures.flatMap(([name, select]) => {
        const observations = pairs.flatMap((pair) => {
          const left = select(pair.baseline);
          const right = select(pair.target);
          return left == null || right == null
            ? []
            : [{ caseName: pair.caseName, delta: right - left }];
        });
        if (observations.length === 0) return [];
        const caseMeans = [
          ...group(observations, (item) => item.caseName).values(),
        ].map((items) => mean(items.map((item) => item.delta))!);
        const [low, high] = bootstrap(caseMeans);
        return [
          [
            baselineMode,
            target,
            name,
            caseMeans.length,
            observations.length,
            mean(caseMeans),
            low,
            high,
          ],
        ];
      });
    });
  return csv(headers, rows);
}

function pairKey(run: StoredRun): string {
  return [
    run.case,
    run.model,
    run.pipeline ?? "deterministic-shell",
    run.representation,
    run.transformation ?? "identity",
    run.seed,
  ].join("\0");
}

function bootstrap(values: number[]): [number, number] {
  if (values.length === 1) return [values[0]!, values[0]!];
  let state = 0x120b;
  const random = () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
  const samples = Array.from(
    { length: 10_000 },
    () =>
      mean(
        Array.from(
          { length: values.length },
          () => values[Math.floor(random() * values.length)]!,
        ),
      )!,
  ).sort((a, b) => a - b);
  return [samples[249]!, samples[9749]!];
}

function group<T>(values: T[], key: (value: T) => string): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const value of values)
    result.set(key(value), [...(result.get(key(value)) ?? []), value]);
  return result;
}

function numbers(values: Array<number | null | undefined>): number[] {
  return values.filter((value): value is number => value != null);
}
function mean(values: number[]): number | null {
  return values.length === 0
    ? null
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}
function csv(
  headers: readonly string[],
  rows: Array<Record<string, unknown> | unknown[]>,
): string {
  return [
    headers,
    ...rows.map((row) =>
      Array.isArray(row)
        ? row
        : headers.map((header) => (row as Record<string, unknown>)[header]),
    ),
  ]
    .map((row) =>
      row
        .map((value) =>
          value == null
            ? ""
            : typeof value === "number" && !Number.isInteger(value)
              ? value.toFixed(6)
              : String(value),
        )
        .join(","),
    )
    .join("\n")
    .concat("\n");
}

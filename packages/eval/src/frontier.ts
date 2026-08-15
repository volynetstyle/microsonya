import type { Score, StoredRun } from "./types.js";

export type FrontierRow = {
  model: string;
  representation: string;
  transformation: string;
  reasoning: string;
  n: number;
  okRuns: number;
  qualityMean: number | null;
  qualityStd: number | null;
  recallMean: number | null;
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

export function operationalQuality(metrics: Score): number | null {
  const values = [
    metrics.weightedClaimRecall,
    metrics.goldClaimPrecision,
    metrics.evidencePrecision,
    metrics.falseOpenQuestionRate,
    metrics.noiseRetention,
  ];
  if (values.some((value) => value === null)) return null;
  return (
    0.35 * metrics.weightedClaimRecall! +
    0.1 * metrics.goldClaimPrecision! +
    0.25 * metrics.evidencePrecision! +
    0.1 * (1 - metrics.forbiddenRate) +
    0.1 * (1 - metrics.falseOpenQuestionRate!) +
    0.1 * (1 - metrics.noiseRetention!)
  );
}

function runQuality(run: StoredRun): number | null {
  return run.status === "ok" ? operationalQuality(run.metrics) : 0;
}

export function frontierRows(runs: StoredRun[]): FrontierRow[] {
  const groups = new Map<string, StoredRun[]>();
  for (const run of runs) {
    const key = JSON.stringify([
      run.model,
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
    const quality = numbers(group.map(runQuality));
    return {
      model: first.model,
      representation: first.representation,
      transformation: first.transformation ?? "identity",
      reasoning: first.reasoning,
      n: group.length,
      okRuns: ok.length,
      qualityMean: mean(quality),
      qualityStd: std(quality),
      recallMean: mean(
        numbers(ok.map((run) => run.metrics.weightedClaimRecall)),
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
    "representation",
    "transformation",
    "reasoning",
    "n",
    "okRuns",
    "qualityMean",
    "qualityStd",
    "recallMean",
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
    "nCases",
    "nPairs",
    "qualityDelta",
    "qualityCiLow",
    "qualityCiHigh",
    "thinkingTokensDelta",
    "finalTokensDelta",
    "latencyMsDelta",
  ];
  const modes = [...new Set(runs.map((run) => run.reasoning))];
  const baselineMode = modes.includes("low") ? "low" : modes[0]!;
  const baseline = new Map(
    runs
      .filter((run) => run.reasoning === baselineMode)
      .map((run) => [`${run.case}\0${run.seed}`, run]),
  );
  const rows = modes
    .filter((mode) => mode !== baselineMode)
    .flatMap((target) => {
      const pairs = runs
        .filter((run) => run.reasoning === target)
        .flatMap((run) => {
          const base = baseline.get(`${run.case}\0${run.seed}`);
          if (!base) return [];
          const left = runQuality(base);
          const right = runQuality(run);
          if (left === null || right === null) return [];
          return [
            {
              caseName: run.case,
              quality: right - left,
              thinking:
                (run.usage.thinkingTextTokenCount ?? 0) -
                (base.usage.thinkingTextTokenCount ?? 0),
              final:
                (run.usage.finalTextTokenCount ?? 0) -
                (base.usage.finalTextTokenCount ?? 0),
              latency: run.usage.durationMs - base.usage.durationMs,
            },
          ];
        });
      if (pairs.length === 0) return [];
      const caseMeans = [...group(pairs, (pair) => pair.caseName).values()].map(
        (items) => mean(items.map((item) => item.quality))!,
      );
      const [low, high] = bootstrap(caseMeans);
      return [
        [
          baselineMode,
          target,
          caseMeans.length,
          pairs.length,
          mean(caseMeans),
          low,
          high,
          mean(pairs.map((pair) => pair.thinking)),
          mean(pairs.map((pair) => pair.final)),
          mean(pairs.map((pair) => pair.latency)),
        ],
      ];
    });
  return csv(headers, rows);
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
function std(values: number[]): number | null {
  const average = mean(values);
  return average === null
    ? null
    : Math.sqrt(
        values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
          values.length,
      );
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

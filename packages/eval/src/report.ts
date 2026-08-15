import type { StoredRun } from "./types.js";

const metricKeys = [
  "majorThreadRecall",
  "weightedClaimRecall",
  "goldClaimPrecision",
  "evidencePrecision",
  "forbiddenRate",
  "falseOpenQuestionRate",
  "noiseRetention",
] as const;

type MetricKey = (typeof metricKeys)[number];

const telemetryKeys = [
  "durationMs",
  "ollamaTotalMs",
  "promptEvalCount",
  "evalCount",
  "thinkingTextTokenCount",
  "finalTextTokenCount",
  "outputTokensPerSecond",
] as const;

type TelemetryKey = (typeof telemetryKeys)[number];

export type AggregateRow = {
  model: string;
  representation: string;
  transformation: string;
  reasoning: string;
  n: number;
  okRuns: number;
  parseFailures: number;
  requestFailures: number;
  validJsonRate: number;
  schemaValidRate: number;
} & Record<`${MetricKey}Mean` | `${MetricKey}Std`, number | null> &
  Record<`${TelemetryKey}Mean` | `${TelemetryKey}Std`, number | null>;

type StageSignal = {
  stage: string;
  signal: string;
  direction: "higher-is-better" | "lower-is-better" | "descriptive";
  select: (run: StoredRun) => number | null;
};

const stageSignals: StageSignal[] = [
  {
    stage: "thread-reconstruction",
    signal: "majorThreadRecall",
    direction: "higher-is-better",
    select: (run) => run.metrics.majorThreadRecall,
  },
  {
    stage: "semantic-extraction",
    signal: "weightedClaimRecall",
    direction: "higher-is-better",
    select: (run) => run.metrics.weightedClaimRecall,
  },
  {
    stage: "semantic-extraction",
    signal: "goldClaimPrecision",
    direction: "higher-is-better",
    select: (run) => run.metrics.goldClaimPrecision,
  },
  {
    stage: "factual-grounding",
    signal: "evidencePrecision",
    direction: "higher-is-better",
    select: (run) => run.metrics.evidencePrecision,
  },
  {
    stage: "factual-grounding",
    signal: "unknownEvidenceIds",
    direction: "lower-is-better",
    select: (run) => run.metrics.unknownEvidenceIds,
  },
  {
    stage: "salience-selection",
    signal: "forbiddenRate",
    direction: "lower-is-better",
    select: (run) => run.metrics.forbiddenRate,
  },
  {
    stage: "salience-selection",
    signal: "noiseRetention",
    direction: "lower-is-better",
    select: (run) => run.metrics.noiseRetention,
  },
  {
    stage: "compression",
    signal: "claimCount",
    direction: "descriptive",
    select: (run) => run.metrics.claimCount,
  },
];

export function runsToCsv(runs: StoredRun[]): string {
  const headers = [
    "case",
    "model",
    "representation",
    "transformation",
    "reasoning",
    "seed",
    "status",
    "validJson",
    "schemaValid",
    "topics",
    "claims",
    "majorThreadRecall",
    "weightedClaimRecall",
    "goldClaimPrecision",
    "evidencePrecision",
    "forbiddenRate",
    "falseOpenQuestionRate",
    "noiseRetention",
    "unknownEvidenceIds",
    "duplicateEvidenceIds",
    "durationMs",
    "ollamaTotalMs",
    "loadMs",
    "promptEvalCount",
    "promptEvalMs",
    "evalCount",
    "thinkingTextTokenCount",
    "finalTextTokenCount",
    "evalMs",
    "outputTokensPerSecond",
    "doneReason",
  ];
  const rows = runs.map((run) => [
    run.case,
    run.model,
    run.representation,
    run.transformation ?? "identity",
    run.reasoning,
    run.seed,
    run.status,
    run.metrics.validJson,
    run.metrics.schemaValid,
    run.metrics.topicCount,
    run.metrics.claimCount,
    run.metrics.majorThreadRecall,
    run.metrics.weightedClaimRecall,
    run.metrics.goldClaimPrecision,
    run.metrics.evidencePrecision,
    run.metrics.forbiddenRate,
    run.metrics.falseOpenQuestionRate,
    run.metrics.noiseRetention,
    run.metrics.unknownEvidenceIds,
    run.metrics.duplicateEvidenceIds,
    Math.round(run.usage.durationMs),
    run.usage.ollamaTotalMs,
    run.usage.loadMs,
    run.usage.promptEvalCount,
    run.usage.promptEvalMs,
    run.usage.evalCount,
    run.usage.thinkingTextTokenCount,
    run.usage.finalTextTokenCount,
    run.usage.evalMs,
    run.usage.outputTokensPerSecond,
    run.usage.doneReason,
  ]);
  return toCsv(headers, rows);
}

export function aggregateRuns(runs: StoredRun[]): AggregateRow[] {
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
    const row = {
      model: first.model,
      representation: first.representation,
      transformation: first.transformation ?? "identity",
      reasoning: first.reasoning,
      n: group.length,
      okRuns: group.filter((run) => run.status === "ok").length,
      parseFailures: group.filter((run) => run.status === "parse_failure")
        .length,
      requestFailures: group.filter((run) => run.status === "request_failure")
        .length,
      validJsonRate:
        group.filter((run) => run.metrics.validJson).length / group.length,
      schemaValidRate:
        group.filter((run) => run.metrics.schemaValid).length / group.length,
    } as AggregateRow;

    for (const key of metricKeys) {
      const values = group
        .map((run) => run.metrics[key])
        .filter((value): value is number => value !== null);
      row[`${key}Mean`] = mean(values);
      row[`${key}Std`] = standardDeviation(values);
    }
    for (const key of telemetryKeys) {
      const values = group
        .map((run) => run.usage[key])
        .filter((value): value is number => value !== undefined);
      row[`${key}Mean`] = mean(values);
      row[`${key}Std`] = standardDeviation(values);
    }
    return row;
  });
}

export function aggregatesToCsv(rows: AggregateRow[]): string {
  const headers = [
    "model",
    "representation",
    "transformation",
    "reasoning",
    "n",
    "okRuns",
    "parseFailures",
    "requestFailures",
    "validJsonRate",
    "schemaValidRate",
    ...metricKeys.flatMap((key) => [`${key}Mean`, `${key}Std`]),
    ...telemetryKeys.flatMap((key) => [`${key}Mean`, `${key}Std`]),
  ];
  return toCsv(
    headers,
    rows.map((row) =>
      headers.map((header) => row[header as keyof AggregateRow]),
    ),
  );
}

export function stagesToCsv(runs: StoredRun[]): string {
  const headers = [
    "model",
    "representation",
    "transformation",
    "reasoning",
    "stage",
    "signal",
    "direction",
    "n",
    "mean",
    "std",
  ];
  const groups = new Map<string, StoredRun[]>();
  for (const run of runs.filter((item) => item.status === "ok")) {
    const key = JSON.stringify([
      run.model,
      run.representation,
      run.transformation ?? "identity",
      run.reasoning,
    ]);
    groups.set(key, [...(groups.get(key) ?? []), run]);
  }
  const rows = [...groups.values()].flatMap((group) => {
    const first = group[0]!;
    return stageSignals.flatMap((stage) => {
      const values = group
        .map(stage.select)
        .filter((value): value is number => value !== null);
      if (values.length === 0) return [];
      return [
        [
          first.model,
          first.representation,
          first.transformation ?? "identity",
          first.reasoning,
          stage.stage,
          stage.signal,
          stage.direction,
          values.length,
          mean(values),
          standardDeviation(values),
        ],
      ];
    });
  });
  return toCsv(headers, rows);
}

export function printRunTable(runs: StoredRun[]): void {
  console.table(
    runs.map((run) => ({
      case: run.case,
      model: run.model,
      repr: run.representation,
      reasoning: run.reasoning,
      seed: run.seed,
      status: run.status,
      threads: formatMetric(run.metrics.majorThreadRecall),
      recall: formatMetric(run.metrics.weightedClaimRecall),
      precision: formatMetric(run.metrics.goldClaimPrecision),
      forbidden: run.metrics.triggeredForbiddenIds.length,
    })),
  );
}

export function printAggregateTable(rows: AggregateRow[]): void {
  console.table(
    rows.map((row) => ({
      model: row.model,
      representation: row.representation,
      transform: row.transformation,
      reasoning: row.reasoning,
      n: row.n,
      ok: `${row.okRuns}/${row.n}`,
      schemaValid: row.schemaValidRate.toFixed(2),
      threadRecall: formatMeanStd(
        row.majorThreadRecallMean,
        row.majorThreadRecallStd,
      ),
      claimRecall: formatMeanStd(
        row.weightedClaimRecallMean,
        row.weightedClaimRecallStd,
      ),
      precision: formatMeanStd(
        row.goldClaimPrecisionMean,
        row.goldClaimPrecisionStd,
      ),
      latencyMs: formatMeanStd(row.durationMsMean, row.durationMsStd),
      outputTokPerSec: formatMeanStd(
        row.outputTokensPerSecondMean,
        row.outputTokensPerSecondStd,
      ),
    })),
  );
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[]): number | null {
  const average = mean(values);
  if (average === null) return null;
  return Math.sqrt(
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
      values.length,
  );
}

function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\n")
    .concat("\n");
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "number" ? round(value) : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function round(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(6);
}

function formatMetric(value: number | null): string {
  return value === null ? "-" : value.toFixed(2);
}

function formatMeanStd(meanValue: number | null, std: number | null): string {
  if (meanValue === null || std === null) return "-";
  return `${meanValue.toFixed(2)} ± ${std.toFixed(2)}`;
}

import { readFile } from "node:fs/promises";

interface Report {
  readonly classifierExemplars: "X2" | "X3" | string;
  readonly totals: {
    readonly runs: number;
    readonly weightedErrors: { readonly critical: number };
    readonly irreversibleLosses: number;
    readonly classifierSafety: {
      readonly durableFalseNegatives: number;
      readonly unsafePrematureSummaries: number;
      readonly costWeightedLoss: number;
    };
  };
}

const [x2Path, x3Path, baselinePath] = process.argv
  .slice(2)
  .filter((value) => value !== "--");
if (!x2Path || !x3Path) {
  throw new TypeError(
    "Usage: tsx test/compareClassifierPolicies.ts X2.json X3.json [baseline.json]",
  );
}

const [x2, x3, baseline] = await Promise.all([
  readReport(x2Path),
  readReport(x3Path),
  baselinePath ? readReport(baselinePath) : undefined,
]);
if (x2.classifierExemplars !== "X2" || x3.classifierExemplars !== "X3") {
  throw new TypeError("Expected X2 and X3 reports in that order.");
}

const candidates = [x2, x3].map(evaluateCandidate);
const baselineDurableFnRate = baseline
  ? rate(baseline, "durableFalseNegatives")
  : null;
const baselineCostPerRun = baseline ? rate(baseline, "costWeightedLoss") : null;
for (const candidate of candidates) {
  if (
    baselineDurableFnRate !== null &&
    candidate.durableFalseNegativeRate > baselineDurableFnRate
  ) {
    candidate.failures.push(
      "durable false-negative rate regressed against baseline",
    );
  }
  if (
    baselineCostPerRun !== null &&
    candidate.costPerRun > baselineCostPerRun
  ) {
    candidate.failures.push(
      "cost-weighted loss per run regressed against baseline",
    );
  }
}

const passing = candidates
  .filter(({ failures }) => failures.length === 0)
  .sort(
    (left, right) =>
      left.costPerRun - right.costPerRun ||
      left.durableFalseNegativeRate - right.durableFalseNegativeRate ||
      left.policy.localeCompare(right.policy),
  );
const result = {
  passed: passing.length > 0,
  winner: passing[0]?.policy ?? null,
  baseline: baseline
    ? {
        durableFalseNegativeRate: baselineDurableFnRate,
        costPerRun: baselineCostPerRun,
      }
    : null,
  candidates,
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.passed) process.exitCode = 1;

function evaluateCandidate(report: Report) {
  const failures: string[] = [];
  if (report.totals.weightedErrors.critical !== 0)
    failures.push("critical errors != 0");
  if (report.totals.irreversibleLosses !== 0)
    failures.push("irreversible errors != 0");
  if (report.totals.classifierSafety.unsafePrematureSummaries !== 0) {
    failures.push("premature summaries != 0");
  }
  return {
    policy: report.classifierExemplars,
    runs: report.totals.runs,
    criticalErrors: report.totals.weightedErrors.critical,
    irreversibleErrors: report.totals.irreversibleLosses,
    prematureSummaries: report.totals.classifierSafety.unsafePrematureSummaries,
    durableFalseNegativeRate: rate(report, "durableFalseNegatives"),
    costPerRun: rate(report, "costWeightedLoss"),
    failures,
  };
}

function rate(
  report: Report,
  key: "durableFalseNegatives" | "costWeightedLoss",
): number {
  if (report.totals.runs <= 0) throw new TypeError("Report has no runs.");
  return report.totals.classifierSafety[key] / report.totals.runs;
}

async function readReport(path: string): Promise<Report> {
  return JSON.parse(await readFile(path, "utf8")) as Report;
}

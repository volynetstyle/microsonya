import { readFile, writeFile } from "node:fs/promises";
import {
  evaluatePropositions,
  type PropositionMetrics,
  type SemanticErrorType,
} from "./propositionEvaluation.js";

const path = process.argv[2];
if (!path)
  throw new TypeError("Usage: tsx test/reEvaluateBaseline.ts <report.json>");

const report = JSON.parse(await readFile(path, "utf8")) as LiveReport;
const evaluated: PropositionMetrics[] = [];

for (const fixture of report.reports) {
  for (const run of fixture.runs) {
    const metrics = evaluatePropositions(fixture.fixtureId, run.summary);
    if (metrics) run.propositionMetrics = metrics;
    if (run.action === "SUMMARIZE" && metrics) evaluated.push(metrics);
  }
}

const passed = evaluated.reduce((sum, metrics) => sum + metrics.passed, 0);
const total = evaluated.reduce((sum, metrics) => sum + metrics.total, 0);
const score = total === 0 ? null : passed / total;
const errorTypes: readonly SemanticErrorType[] = [
  "FACT_OMISSION",
  "FACT_INVENTION",
  "ENTITY_BINDING",
  "NUMERIC_TYPE",
  "PROVENANCE",
  "SUPERSESSION",
  "EPISTEMIC_STATE",
  "SPEECH_ACT",
  "CONDITION_PRESERVATION",
];

report.totals.semanticPropositions = {
  evaluatedSummaries: evaluated.length,
  passed,
  total,
  score,
  errorsByType: Object.fromEntries(
    errorTypes.map((errorType) => [
      errorType,
      evaluated.reduce(
        (sum, metrics) => sum + (metrics.errorsByType[errorType] ?? 0),
        0,
      ),
    ]),
  ),
};
report.totals.releaseGate.semanticPropositionScore =
  score === null || score >= 0.9;
report.totals.releaseGate.passed = [
  report.totals.releaseGate.criticalErrors,
  report.totals.releaseGate.irreversibleLosses,
  report.totals.releaseGate.providerParseFailures,
  report.totals.releaseGate.productSafeActionRate,
  report.totals.releaseGate.semanticPropositionScore,
].every(Boolean);

await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, "utf8");

interface LiveReport {
  reports: Array<{
    fixtureId: string;
    runs: Array<{
      action: string;
      summary?: string;
      propositionMetrics?: PropositionMetrics;
    }>;
  }>;
  totals: {
    semanticPropositions: unknown;
    releaseGate: {
      criticalErrors: boolean;
      irreversibleLosses: boolean;
      providerParseFailures: boolean;
      productSafeActionRate: boolean;
      semanticPropositionScore: boolean;
      passed: boolean;
    };
  };
}

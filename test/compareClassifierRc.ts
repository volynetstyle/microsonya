import { readFile } from "node:fs/promises";

interface ClassifierSafety {
  readonly boundarySafeRate: number;
  readonly durableFalseNegatives: number;
  readonly unsafePrematureSummaries: number;
  readonly actorAttributionErrors: number;
  readonly replyResolutionErrors: number;
  readonly schemaMismatches: number;
  readonly costWeightedLoss: number;
}

interface RcReport {
  readonly classifierRegime: "A0" | "A1" | "A2";
  readonly exemplarOrder: string;
  readonly totals: {
    readonly classifierSafety: ClassifierSafety;
    readonly weightedErrors: { readonly critical: number };
    readonly irreversibleLosses: number;
    readonly policyBehaviorHeadline: { readonly accuracy: number };
  };
  readonly reports: readonly {
    readonly fixtureId: string;
    readonly metrics: { readonly acceptedActionRate: number };
    readonly runs: readonly {
      readonly action: string;
      readonly error?: string;
    }[];
  }[];
}

const paths = process.argv.slice(2).filter((value) => value !== "--");
if (paths.length < 3) {
  throw new TypeError(
    "Usage: tsx test/compareClassifierRc.ts A0.json A1.json A2.json [E1.json ...]",
  );
}

const reports = await Promise.all(paths.map(readReport));
const a0 = requireOne(reports, "A0");
const a1 = requireOne(reports, "A1");
const a2 = requireOne(reports, "A2");
const failures: string[] = [];

for (const candidate of [a1, a2]) {
  const label = candidate.classifierRegime;
  requireZero(
    candidate,
    "critical failures",
    candidate.totals.weightedErrors.critical,
  );
  requireZero(
    candidate,
    "irreversible loss",
    candidate.totals.irreversibleLosses,
  );
  requireZero(
    candidate,
    "durable false negatives",
    candidate.totals.classifierSafety.durableFalseNegatives,
  );
  requireZero(
    candidate,
    "unsafe premature summaries",
    candidate.totals.classifierSafety.unsafePrematureSummaries,
  );
  requireZero(
    candidate,
    "actor-attribution errors",
    candidate.totals.classifierSafety.actorAttributionErrors,
  );
  requireZero(
    candidate,
    "reply-resolution errors",
    candidate.totals.classifierSafety.replyResolutionErrors,
  );
  requireZero(
    candidate,
    "schema mismatches",
    candidate.totals.classifierSafety.schemaMismatches,
  );
  if (
    candidate.totals.classifierSafety.boundarySafeRate <
    a0.totals.classifierSafety.boundarySafeRate
  ) {
    failures.push(`${label}: BoundarySafeRate regressed against A0`);
  }
  if (
    candidate.totals.classifierSafety.costWeightedLoss >
    a0.totals.classifierSafety.costWeightedLoss
  ) {
    failures.push(`${label}: CostWeightedLoss regressed against A0`);
  }
}

const targeted = new Set([
  "banter-with-durable-technical-island",
  "forwarded-message-provenance",
  "missing-context-option",
  "incomplete-memory-leak",
  "reply-crosses-checkpoint",
]);
for (const report of reports.filter(
  ({ exemplarOrder }) => exemplarOrder !== "E0",
)) {
  for (const fixture of report.reports.filter(({ fixtureId }) =>
    targeted.has(fixtureId),
  )) {
    if (
      fixture.metrics.acceptedActionRate !== 1 ||
      fixture.runs.some(({ action, error }) => error || action === "EMPTY")
    ) {
      failures.push(
        `${report.exemplarOrder}/${fixture.fixtureId}: accepted action rate ${fixture.metrics.acceptedActionRate}`,
      );
    }
  }
  requireZero(
    report,
    "order-induced critical failures",
    report.totals.weightedErrors.critical,
  );
  requireZero(
    report,
    "order-induced irreversible loss",
    report.totals.irreversibleLosses,
  );
}

const result = {
  passed: failures.length === 0,
  primaryScore: "CostWeightedLoss",
  regimes: Object.fromEntries(
    [a0, a1, a2].map((report) => [
      report.classifierRegime,
      report.totals.classifierSafety,
    ]),
  ),
  exemplarOrders: reports.map(({ exemplarOrder }) => exemplarOrder),
  failures,
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (failures.length > 0) process.exitCode = 1;

async function readReport(path: string): Promise<RcReport> {
  return JSON.parse(await readFile(path, "utf8")) as RcReport;
}

function requireOne(
  reports: readonly RcReport[],
  regime: RcReport["classifierRegime"],
): RcReport {
  const matches = reports.filter(
    (report) =>
      report.classifierRegime === regime && report.exemplarOrder === "E0",
  );
  if (matches.length !== 1)
    throw new TypeError(`Expected exactly one ${regime}/E0 report.`);
  return matches[0]!;
}

function requireZero(report: RcReport, metric: string, value: number): void {
  if (value !== 0)
    failures.push(
      `${report.classifierRegime}/${report.exemplarOrder}: ${metric} = ${value}`,
    );
}

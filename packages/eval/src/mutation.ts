import type { Experiment, MutationExpectation, StoredRun } from "./types.js";

export type MutationRow = {
  mutation: string;
  baselineCase: string;
  mutantCase: string;
  model: string;
  representation: string;
  transformation: string;
  reasoning: string;
  nPairs: number;
  baselinePassRate: number;
  mutantPassRate: number;
  boundaryPassRate: number;
};

export function mutationOutcomes(
  runs: StoredRun[],
  experiment: Experiment,
): MutationRow[] {
  return experiment.mutations.flatMap((relation) => {
    const rows: MutationRow[] = [];
    for (const model of experiment.models) {
      for (const representation of experiment.representations) {
        for (const transformation of experiment.transformations) {
          for (const reasoning of experiment.reasoning) {
            const scoped = runs.filter(
              (run) =>
                run.model === model &&
                run.representation === representation &&
                (run.transformation ?? "identity") === transformation &&
                run.reasoning === reasoning,
            );
            const mutants = new Map(
              scoped
                .filter((run) => run.case === relation.mutantCase)
                .map((run) => [run.seed, run]),
            );
            const pairs = scoped
              .filter((run) => run.case === relation.baselineCase)
              .map((baseline) => ({
                baseline,
                mutant: mutants.get(baseline.seed),
              }))
              .filter(
                (pair): pair is { baseline: StoredRun; mutant: StoredRun } =>
                  pair.mutant !== undefined,
              );
            if (pairs.length === 0) continue;
            const outcomes = pairs.map((pair) => ({
              baseline: satisfies(pair.baseline, relation.baselineExpect),
              mutant: satisfies(pair.mutant, relation.mutantExpect),
            }));
            rows.push({
              mutation: relation.id,
              baselineCase: relation.baselineCase,
              mutantCase: relation.mutantCase,
              model,
              representation,
              transformation,
              reasoning,
              nPairs: pairs.length,
              baselinePassRate: rate(outcomes.map((item) => item.baseline)),
              mutantPassRate: rate(outcomes.map((item) => item.mutant)),
              boundaryPassRate: rate(
                outcomes.map((item) => item.baseline && item.mutant),
              ),
            });
          }
        }
      }
    }
    return rows;
  });
}

export function mutationRowsToCsv(rows: MutationRow[]): string {
  const headers: Array<keyof MutationRow> = [
    "mutation",
    "baselineCase",
    "mutantCase",
    "model",
    "representation",
    "transformation",
    "reasoning",
    "nPairs",
    "baselinePassRate",
    "mutantPassRate",
    "boundaryPassRate",
  ];
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((key) => csv(row[key])).join(",")),
  ]
    .join("\n")
    .concat("\n");
}

function satisfies(run: StoredRun, expected: MutationExpectation): boolean {
  if (run.status !== "ok") return false;
  const claims = new Set(run.metrics.matchedClaimIds);
  const questions = new Set(run.metrics.matchedOpenQuestionIds ?? []);
  const forbidden = new Set(run.metrics.triggeredForbiddenIds);
  return (
    expected.matchedClaimIds.every((id) => claims.has(id)) &&
    expected.matchedOpenQuestionIds.every((id) => questions.has(id)) &&
    expected.absentForbiddenIds.every((id) => !forbidden.has(id)) &&
    (expected.maxFalseOpenQuestionRate === undefined ||
      (run.metrics.falseOpenQuestionRate ?? 0) <=
        expected.maxFalseOpenQuestionRate)
  );
}

function rate(values: boolean[]): number {
  return values.filter(Boolean).length / values.length;
}

function csv(value: string | number): string {
  if (typeof value === "number")
    return Number.isInteger(value) ? String(value) : value.toFixed(6);
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

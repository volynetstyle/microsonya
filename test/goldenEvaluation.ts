import type { E2EFixture, ExpectedAction } from "./goldenFixtures.js";

export interface E2EResult {
  readonly action: ExpectedAction;
  readonly summary?: string;
  readonly checkpointAdvanced: boolean;
}

export interface EvaluationMetrics {
  readonly accuracy: number;
  readonly stability: number;
  readonly irreversibleLossRate: number;
  readonly unsupportedClaimRate: number;
  readonly checkpointCorrectness: number;
}

export function evaluateRuns(
  fixture: E2EFixture,
  results: readonly E2EResult[],
): EvaluationMetrics {
  if (results.length === 0)
    throw new TypeError("At least one E2E result is required.");

  const expectedAdvance = fixture.expected.checkpoint?.advance;
  const meaningful = isMeaningful(fixture.expected.action);
  let correct = 0;
  let irreversibleLosses = 0;
  let unsupported = 0;
  let checkpointMatches = 0;

  for (const result of results) {
    if (result.action === fixture.expected.action) correct += 1;
    if (
      meaningful &&
      result.action.startsWith("SKIP_") &&
      result.checkpointAdvanced
    ) {
      irreversibleLosses += 1;
    }
    if (hasForbiddenClaim(fixture, result.summary)) unsupported += 1;
    if (
      expectedAdvance === undefined ||
      result.checkpointAdvanced === expectedAdvance
    ) {
      checkpointMatches += 1;
    }
  }

  const total = results.length;
  return Object.freeze({
    accuracy: correct / total,
    stability: dominantShare(results.map(({ action }) => action)),
    irreversibleLossRate: irreversibleLosses / total,
    unsupportedClaimRate: unsupported / total,
    checkpointCorrectness: checkpointMatches / total,
  });
}

export async function assertStable(
  fixture: E2EFixture,
  run: (fixture: E2EFixture) => Promise<E2EResult>,
  runs = 20,
  minimumAccuracy = 0.95,
): Promise<EvaluationMetrics> {
  const results = await Promise.all(
    Array.from({ length: runs }, () => run(fixture)),
  );
  const metrics = evaluateRuns(fixture, results);
  if (metrics.accuracy < minimumAccuracy) {
    throw new Error(
      `${fixture.id} accuracy ${metrics.accuracy} is below ${minimumAccuracy}.`,
    );
  }
  return metrics;
}

function isMeaningful(action: ExpectedAction): boolean {
  return action === "SUMMARIZE" || action.startsWith("DEFER_");
}

function hasForbiddenClaim(fixture: E2EFixture, summary?: string): boolean {
  if (!summary) return false;
  const forbidden = [
    ...(fixture.expected.summary?.mustExclude ?? []),
    ...(fixture.expected.summary?.mustNotInvent ?? []),
  ];
  const normalized = summary.toLocaleLowerCase();
  return forbidden.some((value) =>
    normalized.includes(value.toLocaleLowerCase()),
  );
}

function dominantShare(actions: readonly ExpectedAction[]): number {
  const counts = new Map<ExpectedAction, number>();
  for (const action of actions)
    counts.set(action, (counts.get(action) ?? 0) + 1);
  return Math.max(...counts.values()) / actions.length;
}

import type { E2EFixture, ExpectedAction } from "./goldenFixtures.js";

export interface E2EResult {
  readonly action: ExpectedAction;
  readonly summary?: string;
  readonly checkpointAdvanced: boolean;
}

export interface EvaluationMetrics {
  readonly accuracy: number;
  readonly acceptedActionRate: number;
  readonly stability: number;
  readonly actionDistribution: Readonly<
    Partial<Record<ExpectedAction, number>>
  >;
  readonly irreversibleLossRate: number;
  readonly unsupportedClaimRate: number;
  readonly checkpointCorrectness: number;
}

export type ErrorSeverity = "none" | "low" | "medium" | "critical";

export interface ActionAssessment {
  readonly correct: boolean;
  readonly severity: ErrorSeverity;
  readonly cost: number;
  readonly category: string;
}

export function assessAction(
  fixture: E2EFixture,
  actual: ExpectedAction,
): ActionAssessment {
  const expected = fixture.expected.action;
  if (actual === expected) {
    return { correct: true, severity: "none", cost: 0, category: "correct" };
  }
  if (fixture.status === "under_review") {
    return {
      correct: false,
      severity: "none",
      cost: 0,
      category: "golden_under_review",
    };
  }
  if (isMeaningful(expected) && actual.startsWith("SKIP_")) {
    return {
      correct: false,
      severity: "critical",
      cost: 100,
      category: "irreversible_meaningful_skip",
    };
  }
  if (
    (expected === "DEFER_CONTEXT" || expected === "DEFER_INCOMPLETE") &&
    actual === "SUMMARIZE"
  ) {
    return {
      correct: false,
      severity: "critical",
      cost: 100,
      category: "unsafe_premature_summary",
    };
  }
  if (expected.startsWith("SKIP_") && actual.startsWith("DEFER_")) {
    return {
      correct: false,
      severity: "medium",
      cost: 25,
      category: "sticky_garbage",
    };
  }
  if (expected === "SUMMARIZE" && actual.startsWith("DEFER_")) {
    return {
      correct: false,
      severity: "medium",
      cost: 20,
      category: "rich_content_deferred",
    };
  }
  if (expected === "DEFER_COMPACT" && actual === "SUMMARIZE") {
    return {
      correct: false,
      severity: "low",
      cost: 5,
      category: "unnecessary_summary",
    };
  }
  return {
    correct: false,
    severity: "medium",
    cost: 15,
    category: "other_mismatch",
  };
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
  let accepted = 0;
  let irreversibleLosses = 0;
  let unsupported = 0;
  let checkpointMatches = 0;

  for (const result of results) {
    if (result.action === fixture.expected.action) correct += 1;
    if (isAcceptedAction(fixture, result.action)) accepted += 1;
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
    acceptedActionRate: accepted / total,
    stability: dominantShare(results.map(({ action }) => action)),
    actionDistribution: actionDistribution(results.map(({ action }) => action)),
    irreversibleLossRate: irreversibleLosses / total,
    unsupportedClaimRate: unsupported / total,
    checkpointCorrectness: checkpointMatches / total,
  });
}

export function isAcceptedAction(
  fixture: E2EFixture,
  actual: ExpectedAction,
): boolean {
  return (
    fixture.expected.acceptableActions ?? [fixture.expected.action]
  ).includes(actual);
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

function actionDistribution(
  actions: readonly ExpectedAction[],
): Readonly<Partial<Record<ExpectedAction, number>>> {
  const counts: Partial<Record<ExpectedAction, number>> = {};
  for (const action of actions) counts[action] = (counts[action] ?? 0) + 1;
  return Object.freeze(counts);
}

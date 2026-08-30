import type { ExtractionFixture } from "./extractionFixtures.js";

export interface ExtractionMetrics {
  readonly requiredFactRecall: number;
  readonly unsupportedFactRate: number;
  readonly supersededFactLeakRate: number;
  readonly relationPreservation: number;
  readonly entityBindingAccuracy: number;
  readonly epistemicStateAccuracy: number;
}

export function evaluateExtraction(
  fixture: ExtractionFixture,
  summary: string | undefined,
): ExtractionMetrics {
  const text = normalize(summary ?? "");
  const presentRequired = fixture.required.filter(({ anyOf }) =>
    anyOf.some((value) => text.includes(normalize(value))),
  );
  const leaked = fixture.forbidden.filter(({ anyOf }) =>
    anyOf.some((value) => text.includes(normalize(value))),
  );
  return Object.freeze({
    requiredFactRecall: ratio(presentRequired.length, fixture.required.length),
    unsupportedFactRate: rateFor(leaked, "unsupported", fixture),
    supersededFactLeakRate: rateFor(leaked, "superseded", fixture),
    relationPreservation: recallFor(presentRequired, "relation", fixture),
    entityBindingAccuracy:
      (recallFor(presentRequired, "binding", fixture) +
        1 -
        rateFor(leaked, "binding", fixture)) /
      2,
    epistemicStateAccuracy:
      (recallFor(presentRequired, "epistemic", fixture) +
        1 -
        rateFor(leaked, "epistemic", fixture)) /
      2,
  });
}

function recallFor(
  present: ExtractionFixture["required"],
  dimension: ExtractionFixture["required"][number]["dimension"],
  fixture: ExtractionFixture,
): number {
  const expected = fixture.required.filter(
    (fact) => fact.dimension === dimension,
  );
  if (expected.length === 0) return 1;
  return ratio(
    present.filter((fact) => fact.dimension === dimension).length,
    expected.length,
  );
}

function rateFor(
  leaked: ExtractionFixture["forbidden"],
  dimension: ExtractionFixture["forbidden"][number]["dimension"],
  fixture: ExtractionFixture,
): number {
  const expected = fixture.forbidden.filter(
    (fact) => fact.dimension === dimension,
  );
  if (expected.length === 0) return 0;
  return ratio(
    leaked.filter((fact) => fact.dimension === dimension).length,
    expected.length,
  );
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

function normalize(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[‐‑‒–—―'’`]/gu, " ")
    .replace(/[^\p{L}\p{N}%]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

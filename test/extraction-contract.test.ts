import { describe, expect, it } from "vitest";
import {
  expandExtractionFixture,
  EXTRACTION_PLACEMENTS,
  extractionFixtures,
  injectNoise,
  mandatoryExtraction,
} from "./extractionFixtures.js";
import { evaluateExtraction } from "./extractionEvaluation.js";

describe("long-context extraction fixtures", () => {
  it("contains all mandatory retrieval failure modes", () => {
    const ids = new Set(extractionFixtures.map(({ id }) => id));
    expect(mandatoryExtraction.filter((id) => !ids.has(id))).toEqual([]);
    expect(extractionFixtures).toHaveLength(7);
  });

  it("expands every fixture deterministically at front, middle, and tail", () => {
    const fixture = extractionFixtures[0]!;
    for (const placement of EXTRACTION_PLACEMENTS) {
      const first = expandExtractionFixture(fixture, placement);
      const second = expandExtractionFixture(fixture, placement);
      expect(first).toEqual(second);
      expect(first.messages.length).toBe(fixture.semanticMessages.length + 96);
      expect(first.id).toBe(`${fixture.id}@${placement}`);
    }
  });

  it("supports deterministic interleaved noise expansion", () => {
    const messages = ["one", "two", "three", "four"];
    expect(injectNoise(messages, 2, 3)).toEqual(injectNoise(messages, 2, 3));
    expect(injectNoise(messages, 2, 3)).toHaveLength(10);
  });
});

describe("extraction fidelity metrics", () => {
  it("separates required recall from superseded-state leakage", () => {
    const fixture = extractionFixtures.find(
      ({ id }) => id === "long-frequency-vs-final-state",
    )!;
    const metrics = evaluateExtraction(
      fixture,
      "Free tier має 150 requests/min, paid tier — 1000 requests/min; старий free tier 100 більше не використовується.",
    );
    expect(metrics.requiredFactRecall).toBe(1);
    expect(metrics.supersededFactLeakRate).toBe(1);
  });

  it("scores faithful entity binding without leakage", () => {
    const fixture = extractionFixtures.find(
      ({ id }) => id === "long-two-similar-services",
    )!;
    const metrics = evaluateExtraction(
      fixture,
      "Auth Redis залишається. Profile public metadata кешується локально 5 хвилин; private profile fields не кешуються.",
    );
    expect(metrics.requiredFactRecall).toBe(1);
    expect(metrics.entityBindingAccuracy).toBe(1);
  });
});

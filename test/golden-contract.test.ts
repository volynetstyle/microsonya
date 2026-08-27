import { describe, expect, it } from "vitest";
import { adversarialE2E, goldenFixtures, smokeE2E } from "./goldenFixtures.js";
import { assertStable, evaluateRuns } from "./goldenEvaluation.js";

describe("golden E2E specification", () => {
  it("uses unique stable fixture identifiers", () => {
    const ids = goldenFixtures.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps every mandatory and adversarial case in the catalog", () => {
    const ids = new Set(goldenFixtures.map(({ id }) => id));
    expect(
      [...smokeE2E, ...adversarialE2E].filter((id) => !ids.has(id)),
    ).toEqual([]);
    expect(new Set([...smokeE2E, ...adversarialE2E]).size).toBe(
      smokeE2E.length + adversarialE2E.length,
    );
  });

  it("pins checkpoint expectations to the irreversible transition contract", () => {
    for (const fixture of goldenFixtures) {
      const expected = fixture.expected.checkpoint?.advance;
      if (expected === undefined || fixture.id === "provider-timeout") continue;

      const action = fixture.expected.action;
      expect(expected, fixture.id).toBe(
        action === "SUMMARIZE" || action.startsWith("SKIP_"),
      );
    }
  });
});

describe("golden evaluation metrics", () => {
  const meaningful = goldenFixtures.find(
    ({ id }) => id === "durable-70k-pc-story",
  )!;

  it("counts checkpoint-advancing skips of meaningful windows as irreversible loss", () => {
    expect(
      evaluateRuns(meaningful, [
        { action: "SKIP_BANTER", checkpointAdvanced: true },
        { action: "SUMMARIZE", summary: "70к; 12к", checkpointAdvanced: true },
      ]),
    ).toEqual({
      accuracy: 0.5,
      stability: 0.5,
      irreversibleLossRate: 0.5,
      unsupportedClaimRate: 0,
      checkpointCorrectness: 1,
    });
  });

  it("measures unsupported claims independently from action accuracy", () => {
    const metrics = evaluateRuns(meaningful, [
      {
        action: "SUMMARIZE",
        summary: "70к; жарт як окремий змістовний факт",
        checkpointAdvanced: true,
      },
    ]);
    expect(metrics.accuracy).toBe(1);
    expect(metrics.unsupportedClaimRate).toBe(1);
  });

  it("supports the 19/20 stability acceptance gate", async () => {
    let call = 0;
    const metrics = await assertStable(meaningful, async () => ({
      action: call++ === 0 ? "DEFER_COMPACT" : "SUMMARIZE",
      checkpointAdvanced: call !== 1,
    }));
    expect(metrics.accuracy).toBe(0.95);
    expect(metrics.stability).toBe(0.95);
  });
});

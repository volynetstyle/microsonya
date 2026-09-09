import { describe, expect, it } from "vitest";
import { adversarialE2E, goldenFixtures, smokeE2E } from "./goldenFixtures.js";
import {
  assessAction,
  assertStable,
  evaluateRuns,
  isAcceptedAction,
} from "./goldenEvaluation.js";

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

  it("keeps the production ellipsis/provenance regression highly visible", () => {
    expect(adversarialE2E).toContain(
      "conversational-ellipsis-and-author-boundary",
    );
    const fixture = goldenFixtures.find(
      ({ id }) => id === "conversational-ellipsis-and-author-boundary",
    );
    expect(fixture).toMatchObject({
      source: "live",
      expected: { action: "SUMMARIZE", checkpoint: { advance: true } },
    });
    expect(fixture?.expected.summary?.propositions).toHaveLength(4);
    expect(fixture?.expected.summary?.mustNotInvent).toContain("блок живлення");
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

  it("separates system cases and goldens under review from semantic accuracy", () => {
    expect(
      goldenFixtures
        .filter(({ scope }) => scope === "system")
        .map(({ id }) => id),
    ).toEqual([
      "reply-crosses-checkpoint",
      "edited-message-latest-state",
      "parallel-summary-idempotency",
      "provider-timeout",
    ]);
    expect(
      goldenFixtures
        .filter(({ status }) => status === "under_review")
        .map(({ id }) => id),
    ).toEqual(["durable-70k-pc-story", "summarize-rollout-threshold"]);
  });
});

describe("weighted action errors", () => {
  const fixture = (id: string) =>
    goldenFixtures.find((value) => value.id === id)!;

  it("prices irreversible loss above conservative defer", () => {
    expect(
      assessAction(
        fixture("live-casual-high-information-minecraft"),
        "SKIP_BANTER",
      ),
    ).toMatchObject({
      severity: "critical",
      cost: 100,
    });
    expect(
      assessAction(
        fixture("live-casual-high-information-minecraft"),
        "DEFER_COMPACT",
      ),
    ).toMatchObject({
      severity: "medium",
      cost: 20,
    });
  });

  it("tracks sticky garbage separately", () => {
    expect(
      assessAction(fixture("banter-70k-pc"), "DEFER_COMPACT"),
    ).toMatchObject({
      severity: "medium",
      cost: 25,
      category: "sticky_garbage",
    });
  });

  it("does not score disputed goldens until review is resolved", () => {
    expect(
      assessAction(fixture("summarize-rollout-threshold"), "DEFER_COMPACT"),
    ).toMatchObject({
      severity: "none",
      cost: 0,
      category: "golden_under_review",
    });
  });

  it("separates exact labels from operationally accepted actions", () => {
    expect(
      isAcceptedAction(
        fixture("checkpoint-single-banter-after-summary"),
        "SKIP_NO_VALUE",
      ),
    ).toBe(true);
    expect(
      isAcceptedAction(
        fixture("checkpoint-single-banter-after-summary"),
        "DEFER_COMPACT",
      ),
    ).toBe(false);
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
      acceptedActionRate: 0.5,
      stability: 0.5,
      actionDistribution: { SKIP_BANTER: 1, SUMMARIZE: 1 },
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
    expect(metrics.acceptedActionRate).toBe(1);
    expect(metrics.stability).toBe(0.95);
    expect(metrics.actionDistribution).toEqual({
      DEFER_COMPACT: 1,
      SUMMARIZE: 19,
    });
  });
});

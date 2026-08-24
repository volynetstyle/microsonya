import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  blindDatasetSchema,
  pairedAblationComparisons,
  promptVariantAgreement,
  summarizeBlindRuns,
  validateBlindDataset,
  type BlindRun,
} from "../experimental/eval/src/blindCompaction.js";
import { buildCompactionPrompt } from "../experimental/eval/src/compaction.js";

describe("blind compaction evaluation", () => {
  it("validates 12 independent families and 48 held-out cases", async () => {
    const dataset = blindDatasetSchema.parse(
      JSON.parse(
        await readFile(
          path.join(
            process.cwd(),
            "experimental",
            "eval",
            "cases",
            "compaction-blind-v1.json",
          ),
          "utf8",
        ),
      ),
    );
    expect(() => validateBlindDataset(dataset)).not.toThrow();
    expect(dataset.families).toHaveLength(12);
    expect(dataset.families.flatMap((family) => family.variants)).toHaveLength(
      48,
    );
    expect(dataset.sensitivityPairs).toHaveLength(6);
    expect(
      new Set(
        dataset.families.flatMap((family) =>
          family.variants.map((variant) => variant.domain),
        ),
      ).size,
    ).toBeGreaterThanOrEqual(7);
    expect(
      new Set(
        dataset.families.flatMap((family) =>
          family.variants.map((variant) => variant.language),
        ),
      ),
    ).toEqual(new Set(["uk", "en", "es"]));
  });

  it("scores families and paired interventions atomically", async () => {
    const dataset = blindDatasetSchema.parse(
      JSON.parse(
        await readFile(
          path.join(
            process.cwd(),
            "experimental",
            "eval",
            "cases",
            "compaction-blind-v1.json",
          ),
          "utf8",
        ),
      ),
    );
    const runs: BlindRun[] = dataset.families.flatMap((family) =>
      family.variants.map((variant) => ({
        caseId: `${family.id}/${variant.id}`,
        family: family.id,
        variant: variant.id,
        domain: variant.domain,
        language: variant.language,
        expected: family.expected,
        actual: family.expected,
        completed: true,
        labelValid: true,
        correct: true,
        promptVariant: "original",
        model: "fixture",
        reasoning: "low",
        seed: 42,
        raw: JSON.stringify({ action: family.expected }),
        thinking: "",
        contentLength: 1,
        thinkingLength: 0,
        usage: {},
      })),
    );
    const summary = summarizeBlindRuns(runs, dataset, 100)[0]!;
    expect(summary).toMatchObject({
      endToEndAccuracy: 1,
      caseAccuracy: 1,
      familyAccuracy: 1,
      strictFamilyAccuracy: 1,
      strictSensitivityTransitionAccuracy: 1,
      transitionRate: 1,
      strictSurfaceInvarianceAccuracy: 1,
      surfaceAgreement: 1,
    });

    runs.find((run) => run.family === "reaction-only")!.correct = false;
    runs.find((run) => run.family === "reaction-only")!.actual =
      "DEFER_COMPACT";
    const failed = summarizeBlindRuns(runs, dataset, 100)[0]!;
    expect(failed.caseAccuracy).toBeLessThan(1);
    expect(failed.strictFamilyAccuracy).toBeLessThan(1);
    expect(failed.strictSensitivityTransitionAccuracy).toBeLessThan(1);
    expect(failed.strictSurfaceInvarianceAccuracy).toBeLessThan(1);
    expect(promptVariantAgreement(runs)).toEqual([]);

    const replayRuns = runs.map((run) => ({
      ...run,
      promptVariant: "identity-replay" as const,
    }));
    const paired = pairedAblationComparisons(
      [...runs, ...replayRuns],
      dataset,
      100,
    );
    expect(paired).not.toHaveLength(0);
    expect(paired.every((row) => row.delta === 0)).toBe(true);
  });

  it("keeps policy fixed while varying only calibration examples", () => {
    const fixture = {
      id: "probe",
      expected: "DEFER_COMPACT" as const,
      messages: [{ user: "A", time: "10:00", text: "A compact update." }],
    };
    const original = buildCompactionPrompt(fixture, "original");
    const rulesOnly = buildCompactionPrompt(fixture, "rules-only");
    const crossDomain = buildCompactionPrompt(fixture, "cross-domain");
    const identityReplay = buildCompactionPrompt(fixture, "identity-replay");
    const policyMarker =
      "Apply these rules in order. Stop at the first matching rule.";
    expect(original).toContain(policyMarker);
    expect(rulesOnly).toContain(policyMarker);
    expect(crossDomain).toContain(policyMarker);
    expect(original).toContain("Boundary examples:");
    expect(identityReplay).toBe(original);
    expect(rulesOnly).not.toContain("Boundary examples:");
    expect(crossDomain).toContain("The hearing moved to Tuesday.");
    expect(crossDomain).not.toContain("Stripe");
  });
});

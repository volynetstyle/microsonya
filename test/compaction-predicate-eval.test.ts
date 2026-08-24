import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  blindDatasetSchema,
  type BlindRun,
} from "../experimental/eval/src/blindCompaction.js";
import {
  compareDirectAndPredicate,
  parseCompactionPredicates,
  predicateGoldSchema,
  projectPredicatesToAction,
  validatePredicateGold,
  type PredicateRun,
} from "../experimental/eval/src/predicateCompaction.js";

async function fixtures() {
  const root = path.join(process.cwd(), "experimental", "eval", "cases");
  const dataset = blindDatasetSchema.parse(
    JSON.parse(
      await readFile(path.join(root, "compaction-blind-v1.json"), "utf8"),
    ),
  );
  const gold = predicateGoldSchema.parse(
    JSON.parse(
      await readFile(
        path.join(root, "compaction-blind-predicates-v1.json"),
        "utf8",
      ),
    ),
  );
  return { dataset, gold };
}

describe("predicate compaction evaluation", () => {
  it("covers the holdout and projects every gold vector to its label", async () => {
    const { dataset, gold } = await fixtures();
    expect(() => validatePredicateGold(gold, dataset)).not.toThrow();
    expect(gold.families).toHaveLength(12);
    for (const family of dataset.families) {
      const predicates = gold.families.find(
        (item) => item.id === family.id,
      )!.predicates;
      expect(projectPredicatesToAction(predicates)).toBe(family.expected);
    }
  });

  it("applies precedence and rejects non-strict output", () => {
    expect(
      projectPredicatesToAction({
        durable: false,
        essentialReferentsResolved: false,
        visiblyIncomplete: true,
        alreadyCompact: true,
        primarilyReaction: true,
        primarilyBanter: true,
      }),
    ).toBe("SKIP_REACTIONS");
    expect(
      parseCompactionPredicates(
        '```json\n{"durable":false,"essentialReferentsResolved":true,"visiblyIncomplete":false,"alreadyCompact":false,"primarilyReaction":true,"primarilyBanter":false}\n```',
      ),
    ).toBeNull();
    expect(
      parseCompactionPredicates(
        '{"durable":false,"essentialReferentsResolved":true,"visiblyIncomplete":false,"alreadyCompact":false,"primarilyReaction":true,"primarilyBanter":false,"action":"SKIP_REACTIONS"}',
      ),
    ).toBeNull();
  });

  it("attributes matched direct and predicate outcomes", async () => {
    const { dataset, gold } = await fixtures();
    const direct: BlindRun[] = [];
    const predicates: PredicateRun[] = [];
    for (const family of dataset.families) {
      const expectedPredicates = gold.families.find(
        (item) => item.id === family.id,
      )!.predicates;
      for (const variant of family.variants) {
        const common = {
          caseId: `${family.id}/${variant.id}`,
          family: family.id,
          variant: variant.id,
          domain: variant.domain,
          language: variant.language,
          expected: family.expected,
          model: "fixture",
          reasoning: "low" as const,
          seed: 42,
          raw: "{}",
          thinking: "",
          contentLength: 2,
          thinkingLength: 0,
          usage: {},
        };
        direct.push({
          ...common,
          actual: null,
          completed: true,
          labelValid: false,
          correct: false,
          promptVariant: "original",
        });
        predicates.push({
          ...common,
          expectedPredicates,
          predicates: expectedPredicates,
          actual: family.expected,
          completed: true,
          schemaValid: true,
          predicateExact: true,
          correct: true,
        });
      }
    }
    const result = compareDirectAndPredicate(direct, predicates, dataset, 100);
    expect(result).toMatchObject({
      directEndToEndAccuracy: 0,
      predicateProjectedEndToEndAccuracy: 1,
      pairedDelta: 1,
    });
    expect(result.diagnosticCounts).toEqual({
      "predicate-correct-direct-wrong": 48,
    });
  });
});

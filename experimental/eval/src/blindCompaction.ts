import { z } from "zod";
import {
  compactionActionSchema,
  compactionPromptVariantSchema,
  compactionFixtureSchema,
  type CompactionAction,
  type CompactionPromptVariant,
} from "./compaction.js";
import { reasoningSchema } from "./types.js";

const blindVariantSchema = z
  .object({
    id: z.string().min(1),
    domain: z.string().min(1),
    language: z.string().min(1),
    messages: compactionFixtureSchema.element.shape.messages,
  })
  .strict();

const blindFamilySchema = z
  .object({
    id: z.string().min(1),
    expected: compactionActionSchema,
    variants: z.array(blindVariantSchema).min(2),
  })
  .strict();

const sensitivityPairSchema = z
  .object({
    id: z.string().min(1),
    leftFamily: z.string().min(1),
    rightFamily: z.string().min(1),
  })
  .strict();

export const blindDatasetSchema = z
  .object({
    id: z.string().min(1),
    promptVersion: z.literal("v10"),
    families: z.array(blindFamilySchema).min(2),
    sensitivityPairs: z.array(sensitivityPairSchema).min(1),
  })
  .strict();

const generationOptionsSchema = z
  .object({
    temperature: z.number().nonnegative(),
    topK: z.number().int().positive(),
    topP: z.number().min(0).max(1),
    minP: z.number().min(0).max(1),
    numPredict: z.number().int().positive(),
    repeatPenalty: z.number().positive(),
    presencePenalty: z.number(),
    frequencyPenalty: z.number(),
  })
  .strict();

export const blindExperimentSchema = z
  .object({
    dataset: z.string().min(1),
    models: z.array(z.string().min(1)).min(1),
    reasoning: z.array(reasoningSchema).min(1),
    think: reasoningSchema,
    seeds: z.array(z.number().int()).min(1),
    promptVariants: z.array(compactionPromptVariantSchema).min(1),
    generationOptions: generationOptionsSchema,
    promptVersion: z.literal("v10"),
    bootstrapSamples: z.number().int().positive().default(2000),
  })
  .strict();

export type BlindDataset = z.infer<typeof blindDatasetSchema>;
export type BlindExperiment = z.infer<typeof blindExperimentSchema>;

export type BlindRun = {
  caseId: string;
  family: string;
  variant: string;
  domain: string;
  language: string;
  expected: CompactionAction;
  actual: CompactionAction | null;
  completed: boolean;
  labelValid: boolean;
  correct: boolean;
  promptVariant: CompactionPromptVariant;
  model: string;
  reasoning: z.infer<typeof reasoningSchema>;
  seed: number;
  raw: string;
  thinking: string;
  contentLength: number;
  thinkingLength: number;
  usage: unknown;
};

export type BlindSummary = ReturnType<typeof summarizeBlindRuns>;

export function promptVariantAgreement(runs: BlindRun[]) {
  const cells = groupBy(
    runs,
    (run) => `${run.model}|${run.reasoning}|${run.seed}`,
  );
  const rows = [];
  for (const cell of cells.values()) {
    const first = cell[0]!;
    const variants = [...new Set(cell.map((run) => run.promptVariant))].sort();
    for (let leftIndex = 0; leftIndex < variants.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < variants.length;
        rightIndex += 1
      ) {
        const leftVariant = variants[leftIndex]!;
        const rightVariant = variants[rightIndex]!;
        let comparable = 0;
        let agreed = 0;
        for (const left of cell.filter(
          (run) => run.promptVariant === leftVariant,
        )) {
          const right = cell.find(
            (run) =>
              run.promptVariant === rightVariant && run.caseId === left.caseId,
          );
          if (!right || left.actual === null || right.actual === null) continue;
          comparable += 1;
          if (left.actual === right.actual) agreed += 1;
        }
        rows.push({
          model: first.model,
          reasoning: first.reasoning,
          seed: first.seed,
          leftVariant,
          rightVariant,
          comparable,
          agreement: ratio(agreed, comparable),
        });
      }
    }
  }
  return rows;
}

export function validateBlindDataset(dataset: BlindDataset): void {
  const familyIds = new Set<string>();
  for (const family of dataset.families) {
    if (familyIds.has(family.id))
      throw new Error(`Duplicate family ${family.id}`);
    familyIds.add(family.id);
    const variantIds = new Set<string>();
    for (const variant of family.variants) {
      if (variantIds.has(variant.id))
        throw new Error(`Duplicate variant ${family.id}/${variant.id}`);
      variantIds.add(variant.id);
    }
  }
  for (const pair of dataset.sensitivityPairs) {
    const left = dataset.families.find(
      (family) => family.id === pair.leftFamily,
    );
    const right = dataset.families.find(
      (family) => family.id === pair.rightFamily,
    );
    if (!left || !right)
      throw new Error(`Pair ${pair.id} references missing family`);
    if (left.expected === right.expected)
      throw new Error(`Sensitivity pair ${pair.id} must cross labels`);
    const leftVariants = left.variants.map((variant) => variant.id).sort();
    const rightVariants = right.variants.map((variant) => variant.id).sort();
    if (JSON.stringify(leftVariants) !== JSON.stringify(rightVariants))
      throw new Error(`Pair ${pair.id} must align variant IDs`);
  }
}

export function summarizeBlindRuns(
  runs: BlindRun[],
  dataset: BlindDataset,
  bootstrapSamples: number,
) {
  const cells = groupBy(
    runs,
    (run) => `${run.promptVariant}|${run.model}|${run.reasoning}|${run.seed}`,
  );
  return [...cells.values()].map((cell) => {
    const first = cell[0]!;
    const core = coreMetrics(cell, dataset);
    const byDomain = breakdown(cell, (run) => run.domain);
    const byLanguage = breakdown(cell, (run) => run.language);
    return {
      promptVariant: first.promptVariant,
      model: first.model,
      reasoning: first.reasoning,
      seed: first.seed,
      ...core,
      byDomain,
      byLanguage,
      domainGap: range(byDomain.map((item) => item.accuracy)),
      crossLanguageTransfer: {
        primaryLanguageAccuracy:
          byLanguage.find((item) => item.name === "uk")?.accuracy ?? 0,
        otherLanguageAccuracy: ratio(
          cell.filter((run) => run.language !== "uk" && run.correct).length,
          cell.filter((run) => run.language !== "uk").length,
        ),
      },
      bootstrap95: bootstrapByBoundary(
        cell,
        dataset,
        bootstrapSamples,
        hashSeed(`${first.promptVariant}|${first.model}|${first.seed}`),
      ),
    };
  });
}

function coreMetrics(runs: BlindRun[], dataset: BlindDataset) {
  const completed = runs.filter((run) => run.completed).length;
  const valid = runs.filter((run) => run.labelValid).length;
  const correct = runs.filter((run) => run.correct).length;
  const families = dataset.families.map((family) => {
    const items = runs.filter((run) => run.family === family.id);
    const familyCorrect = items.filter((run) => run.correct).length;
    return {
      family: family.id,
      expected: family.expected,
      correct: familyCorrect,
      total: items.length,
      accuracy: ratio(familyCorrect, items.length),
      strict: items.length > 0 && familyCorrect === items.length,
    };
  });
  const sensitivity = sensitivityOutcomes(runs, dataset);
  const invariance = invarianceOutcomes(runs, dataset);
  return {
    total: runs.length,
    completionRate: ratio(completed, runs.length),
    validLabelRate: ratio(valid, completed),
    caseAccuracy: ratio(correct, valid),
    familyAccuracy: mean(families.map((family) => family.accuracy)),
    strictFamilyAccuracy: ratio(
      families.filter((family) => family.strict).length,
      families.length,
    ),
    sensitivityTransitionAccuracy: ratio(
      sensitivity.filter((item) => item.passed).length,
      sensitivity.length,
    ),
    surfaceInvarianceRate: ratio(
      invariance.filter((item) => item.passed).length,
      invariance.length,
    ),
    families,
    sensitivity,
    invariance,
  };
}

function sensitivityOutcomes(runs: BlindRun[], dataset: BlindDataset) {
  const outcomes = [];
  for (const pair of dataset.sensitivityPairs) {
    const leftRuns = runs.filter((run) => run.family === pair.leftFamily);
    for (const left of leftRuns) {
      const right = runs.find(
        (run) =>
          run.family === pair.rightFamily && run.variant === left.variant,
      );
      if (!right) continue;
      outcomes.push({
        pair: pair.id,
        variant: left.variant,
        leftCase: left.caseId,
        rightCase: right.caseId,
        passed:
          left.correct &&
          right.correct &&
          left.actual !== null &&
          right.actual !== null &&
          left.actual !== right.actual,
      });
    }
  }
  return outcomes;
}

function invarianceOutcomes(runs: BlindRun[], dataset: BlindDataset) {
  const outcomes = [];
  for (const family of dataset.families) {
    const items = runs.filter((run) => run.family === family.id);
    for (let leftIndex = 0; leftIndex < items.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < items.length;
        rightIndex += 1
      ) {
        const left = items[leftIndex]!;
        const right = items[rightIndex]!;
        outcomes.push({
          family: family.id,
          leftCase: left.caseId,
          rightCase: right.caseId,
          passed:
            left.correct &&
            right.correct &&
            left.actual !== null &&
            left.actual === right.actual,
        });
      }
    }
  }
  return outcomes;
}

function breakdown(runs: BlindRun[], key: (run: BlindRun) => string) {
  return [...groupBy(runs, key).entries()].map(([name, items]) => ({
    name,
    total: items.length,
    accuracy: ratio(items.filter((item) => item.correct).length, items.length),
  }));
}

function bootstrapByBoundary(
  runs: BlindRun[],
  dataset: BlindDataset,
  samples: number,
  seed: number,
) {
  const clusters = dataset.sensitivityPairs.map((pair) => [
    pair.leftFamily,
    pair.rightFamily,
  ]);
  const rng = xorshift32(seed);
  const values = {
    caseAccuracy: [] as number[],
    strictFamilyAccuracy: [] as number[],
    sensitivityTransitionAccuracy: [] as number[],
  };
  for (let sample = 0; sample < samples; sample += 1) {
    const sampledRuns: BlindRun[] = [];
    const sampledFamilies = [];
    const sampledPairs = [];
    for (let index = 0; index < clusters.length; index += 1) {
      const selected = Math.floor(rng() * clusters.length);
      const familyIds = clusters[selected]!;
      sampledRuns.push(...runs.filter((run) => familyIds.includes(run.family)));
      sampledFamilies.push(
        ...dataset.families.filter((family) => familyIds.includes(family.id)),
      );
      sampledPairs.push(dataset.sensitivityPairs[selected]!);
    }
    const sampledDataset = {
      ...dataset,
      families: sampledFamilies,
      sensitivityPairs: sampledPairs,
    };
    const core = coreMetricsWithoutBootstrap(sampledRuns, sampledDataset);
    values.caseAccuracy.push(core.caseAccuracy);
    values.strictFamilyAccuracy.push(core.strictFamilyAccuracy);
    values.sensitivityTransitionAccuracy.push(
      core.sensitivityTransitionAccuracy,
    );
  }
  return Object.fromEntries(
    Object.entries(values).map(([name, samplesForMetric]) => [
      name,
      interval(samplesForMetric),
    ]),
  );
}

function coreMetricsWithoutBootstrap(runs: BlindRun[], dataset: BlindDataset) {
  const valid = runs.filter((run) => run.labelValid).length;
  const correct = runs.filter((run) => run.correct).length;
  const familyStrict = dataset.families.map((family) => {
    const items = runs.filter((run) => run.family === family.id);
    return items.length > 0 && items.every((item) => item.correct);
  });
  const sensitivity = sensitivityOutcomes(runs, dataset);
  return {
    caseAccuracy: ratio(correct, valid),
    strictFamilyAccuracy: ratio(
      familyStrict.filter(Boolean).length,
      familyStrict.length,
    ),
    sensitivityTransitionAccuracy: ratio(
      sensitivity.filter((item) => item.passed).length,
      sensitivity.length,
    ),
  };
}

function interval(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    low: sorted[Math.floor(sorted.length * 0.025)] ?? 0,
    high:
      sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.975))] ??
      0,
  };
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function mean(values: number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function range(values: number[]): number {
  return values.length === 0 ? 0 : Math.max(...values) - Math.min(...values);
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const name = key(item);
    const group = groups.get(name) ?? [];
    group.push(item);
    groups.set(name, group);
  }
  return groups;
}

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function xorshift32(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

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

export function pairedAblationComparisons(
  runs: BlindRun[],
  dataset: BlindDataset,
  bootstrapSamples: number,
) {
  const cells = groupBy(
    runs,
    (run) => `${run.model}|${run.reasoning}|${run.seed}`,
  );
  const rows = [];
  const metricNames = [
    "endToEndAccuracy",
    "caseAccuracy",
    "strictFamilyAccuracy",
    "strictSensitivityTransitionAccuracy",
    "transitionRate",
    "strictSurfaceInvarianceAccuracy",
    "surfaceAgreement",
  ] as const;
  for (const cell of cells.values()) {
    const first = cell[0]!;
    const baseline = cell.filter((run) => run.promptVariant === "original");
    if (baseline.length === 0) continue;
    const targets = [...new Set(cell.map((run) => run.promptVariant))].filter(
      (variant) => variant !== "original",
    );
    for (const targetVariant of targets) {
      const target = cell.filter((run) => run.promptVariant === targetVariant);
      const baselineMetrics = coreMetricsWithoutBootstrap(baseline, dataset);
      const targetMetrics = coreMetricsWithoutBootstrap(target, dataset);
      const distributions = Object.fromEntries(
        metricNames.map((name) => [name, [] as number[]]),
      ) as Record<(typeof metricNames)[number], number[]>;
      const rng = xorshift32(
        hashSeed(`${first.model}|${first.seed}|${targetVariant}|paired`),
      );
      for (let sample = 0; sample < bootstrapSamples; sample += 1) {
        const sampledPairs = [];
        const sampledFamilies = [];
        const baselineSample: BlindRun[] = [];
        const targetSample: BlindRun[] = [];
        for (
          let index = 0;
          index < dataset.sensitivityPairs.length;
          index += 1
        ) {
          const selected = Math.floor(rng() * dataset.sensitivityPairs.length);
          const pair = dataset.sensitivityPairs[selected]!;
          const familyIds = [pair.leftFamily, pair.rightFamily];
          sampledPairs.push(pair);
          sampledFamilies.push(
            ...dataset.families.filter((family) =>
              familyIds.includes(family.id),
            ),
          );
          baselineSample.push(
            ...baseline.filter((run) => familyIds.includes(run.family)),
          );
          targetSample.push(
            ...target.filter((run) => familyIds.includes(run.family)),
          );
        }
        const sampledDataset = {
          ...dataset,
          families: sampledFamilies,
          sensitivityPairs: sampledPairs,
        };
        const baselineCore = coreMetricsWithoutBootstrap(
          baselineSample,
          sampledDataset,
        );
        const targetCore = coreMetricsWithoutBootstrap(
          targetSample,
          sampledDataset,
        );
        for (const name of metricNames)
          distributions[name].push(targetCore[name] - baselineCore[name]);
      }
      for (const name of metricNames) {
        rows.push({
          model: first.model,
          reasoning: first.reasoning,
          seed: first.seed,
          baselineVariant: "original" as const,
          targetVariant,
          metric: name,
          delta: targetMetrics[name] - baselineMetrics[name],
          bootstrap95: interval(distributions[name]),
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
    const languageDomainCells = breakdown(
      cell,
      (run) => `${run.domain}|${run.language}`,
    );
    return {
      promptVariant: first.promptVariant,
      model: first.model,
      reasoning: first.reasoning,
      seed: first.seed,
      ...core,
      byDomain,
      byLanguage,
      domainGap: range(byDomain.map((item) => item.accuracy)),
      languageDomainCells,
      matchedLanguageAnalysis: matchedLanguageAnalysis(cell),
      confusionMatrix: confusionMatrix(cell),
      leaveOneBoundaryClusterOut: leaveOneBoundaryClusterOut(cell, dataset),
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
    endToEndAccuracy: ratio(correct, runs.length),
    caseAccuracy: ratio(correct, valid),
    familyAccuracy: mean(families.map((family) => family.accuracy)),
    strictFamilyAccuracy: ratio(
      families.filter((family) => family.strict).length,
      families.length,
    ),
    strictSensitivityTransitionAccuracy: ratio(
      sensitivity.filter((item) => item.strictPassed).length,
      sensitivity.length,
    ),
    transitionRate: ratio(
      sensitivity.filter((item) => item.transitioned).length,
      sensitivity.filter((item) => item.comparable).length,
    ),
    strictSurfaceInvarianceAccuracy: ratio(
      invariance.filter((item) => item.strictPassed).length,
      invariance.length,
    ),
    surfaceAgreement: ratio(
      invariance.filter((item) => item.agreed).length,
      invariance.filter((item) => item.comparable).length,
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
        comparable: left.actual !== null && right.actual !== null,
        transitioned:
          left.actual !== null &&
          right.actual !== null &&
          left.actual !== right.actual,
        strictPassed:
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
          comparable: left.actual !== null && right.actual !== null,
          agreed:
            left.actual !== null &&
            right.actual !== null &&
            left.actual === right.actual,
          strictPassed:
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

function confusionMatrix(runs: BlindRun[]) {
  const matrix: Record<string, Record<string, number>> = {};
  for (const run of runs) {
    const actual = !run.completed
      ? "NO_CONTENT"
      : run.actual === null
        ? "INVALID"
        : run.actual;
    matrix[run.expected] ??= {};
    matrix[run.expected]![actual] = (matrix[run.expected]![actual] ?? 0) + 1;
  }
  return matrix;
}

function matchedLanguageAnalysis(runs: BlindRun[]) {
  const comparisons = [];
  for (const [domain, items] of groupBy(runs, (run) => run.domain)) {
    const languages = [...groupBy(items, (run) => run.language).entries()];
    if (languages.length < 2) continue;
    for (let leftIndex = 0; leftIndex < languages.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < languages.length;
        rightIndex += 1
      ) {
        const [leftLanguage, leftRuns] = languages[leftIndex]!;
        const [rightLanguage, rightRuns] = languages[rightIndex]!;
        comparisons.push({
          domain,
          leftLanguage,
          rightLanguage,
          leftAccuracy: ratio(
            leftRuns.filter((run) => run.correct).length,
            leftRuns.length,
          ),
          rightAccuracy: ratio(
            rightRuns.filter((run) => run.correct).length,
            rightRuns.length,
          ),
        });
      }
    }
  }
  return {
    available: comparisons.length > 0,
    confounded: comparisons.length === 0,
    comparisons,
  };
}

function leaveOneBoundaryClusterOut(runs: BlindRun[], dataset: BlindDataset) {
  return dataset.sensitivityPairs.map((pair) => {
    const retainedRuns = runs.filter(
      (run) =>
        run.family !== pair.leftFamily && run.family !== pair.rightFamily,
    );
    const retainedDataset = {
      ...dataset,
      families: dataset.families.filter(
        (family) =>
          family.id !== pair.leftFamily && family.id !== pair.rightFamily,
      ),
      sensitivityPairs: dataset.sensitivityPairs.filter(
        (candidate) => candidate.id !== pair.id,
      ),
    };
    return {
      omittedBoundary: pair.id,
      ...coreMetricsWithoutBootstrap(retainedRuns, retainedDataset),
    };
  });
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
    endToEndAccuracy: [] as number[],
    conditionalCaseAccuracy: [] as number[],
    strictFamilyAccuracy: [] as number[],
    strictSensitivityTransitionAccuracy: [] as number[],
    transitionRate: [] as number[],
    strictSurfaceInvarianceAccuracy: [] as number[],
    surfaceAgreement: [] as number[],
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
    values.endToEndAccuracy.push(core.endToEndAccuracy);
    values.conditionalCaseAccuracy.push(core.caseAccuracy);
    values.strictFamilyAccuracy.push(core.strictFamilyAccuracy);
    values.strictSensitivityTransitionAccuracy.push(
      core.strictSensitivityTransitionAccuracy,
    );
    values.transitionRate.push(core.transitionRate);
    values.strictSurfaceInvarianceAccuracy.push(
      core.strictSurfaceInvarianceAccuracy,
    );
    values.surfaceAgreement.push(core.surfaceAgreement);
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
  const invariance = invarianceOutcomes(runs, dataset);
  return {
    endToEndAccuracy: ratio(correct, runs.length),
    caseAccuracy: ratio(correct, valid),
    strictFamilyAccuracy: ratio(
      familyStrict.filter(Boolean).length,
      familyStrict.length,
    ),
    strictSensitivityTransitionAccuracy: ratio(
      sensitivity.filter((item) => item.strictPassed).length,
      sensitivity.length,
    ),
    transitionRate: ratio(
      sensitivity.filter((item) => item.transitioned).length,
      sensitivity.filter((item) => item.comparable).length,
    ),
    strictSurfaceInvarianceAccuracy: ratio(
      invariance.filter((item) => item.strictPassed).length,
      invariance.length,
    ),
    surfaceAgreement: ratio(
      invariance.filter((item) => item.agreed).length,
      invariance.filter((item) => item.comparable).length,
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

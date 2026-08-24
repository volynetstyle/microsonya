import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import {
  blindDatasetSchema,
  blindExperimentSchema,
  summarizeBlindRuns,
  validateBlindDataset,
  type BlindRun,
} from "./blindCompaction.js";
import {
  buildPredicatePrompt,
  compareDirectAndPredicate,
  parseCompactionPredicates,
  predicateGoldSchema,
  projectPredicatesToAction,
  summarizePredicates,
  toProjectedBlindRuns,
  validatePredicateGold,
  type PredicateRun,
} from "./predicateCompaction.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
loadEnv({ path: path.resolve(packageRoot, "../../.env") });
const args = process.argv.slice(2);
const experimentName =
  args.find((argument) => !argument.startsWith("--")) ??
  "compaction-blind-predicates-v1";
const validateOnly = args.includes("--validate-only");
const rescoreOnly = args.includes("--rescore");
if (!/^[a-zA-Z0-9._-]+$/.test(experimentName))
  throw new Error("Unsafe experiment name");

const experimentFile = path.join(
  packageRoot,
  "experiments",
  `${experimentName}.json`,
);
const rawExperiment = (await readJson(experimentFile)) as Record<
  string,
  unknown
>;
const directExperiment = String(rawExperiment.directExperiment);
const predicateGoldName = String(rawExperiment.predicateGold);
const experiment = blindExperimentSchema.parse(
  Object.fromEntries(
    Object.entries(rawExperiment).filter(
      ([key]) => key !== "directExperiment" && key !== "predicateGold",
    ),
  ),
);
if (
  experiment.promptVariants.length !== 1 ||
  experiment.promptVariants[0] !== "original"
)
  throw new Error("Predicate eval accepts only the original prompt cell");
const dataset = blindDatasetSchema.parse(
  await readJson(path.join(packageRoot, "cases", `${experiment.dataset}.json`)),
);
const gold = predicateGoldSchema.parse(
  await readJson(path.join(packageRoot, "cases", `${predicateGoldName}.json`)),
);
validateBlindDataset(dataset);
validatePredicateGold(gold, dataset);
if (gold.sourceDataset !== experiment.dataset)
  throw new Error("Predicate gold and experiment datasets differ");
const caseCount = dataset.families.reduce(
  (sum, family) => sum + family.variants.length,
  0,
);
const planned =
  caseCount *
  experiment.models.length *
  experiment.reasoning.length *
  experiment.seeds.length;
if (validateOnly) {
  console.log(
    `Validated ${gold.families.length} predicate families / ${caseCount} blind cases; planned runs: ${planned}`,
  );
  process.exit(0);
}

const resultsRoot = path.join(packageRoot, "results", experimentName);
let runs: PredicateRun[];
if (rescoreOnly) {
  runs = JSON.parse(
    await readFile(path.join(resultsRoot, "runs.json"), "utf8"),
  ) as PredicateRun[];
  if (runs.length !== planned)
    throw new Error(
      `Stored run count ${runs.length} does not match ${planned}`,
    );
} else {
  const { runOllama } = await import("./ollama.js");
  runs = [];
  for (const model of experiment.models)
    for (const reasoning of experiment.reasoning)
      for (const seed of experiment.seeds)
        for (const family of dataset.families) {
          const expectedPredicates = gold.families.find(
            (item) => item.id === family.id,
          )!.predicates;
          for (const variant of family.variants) {
            const fixture = {
              id: `${family.id}/${variant.id}`,
              expected: family.expected,
              messages: variant.messages,
            };
            const response = await runOllama({
              model,
              prompt: buildPredicatePrompt(fixture),
              reasoning,
              think: experiment.think,
              seed,
              generationOptions: experiment.generationOptions,
              baseUrl: process.env.OLLAMA_BASE_URL,
              apiKey: process.env.OLLAMA_API_KEY,
            });
            const predicates = parseCompactionPredicates(response.content);
            const actual = predicates
              ? projectPredicatesToAction(predicates)
              : null;
            runs.push({
              caseId: fixture.id,
              family: family.id,
              variant: variant.id,
              domain: variant.domain,
              language: variant.language,
              expected: family.expected,
              expectedPredicates,
              predicates,
              actual,
              completed: response.content.length > 0,
              schemaValid: predicates !== null,
              predicateExact:
                predicates !== null &&
                JSON.stringify(predicates) ===
                  JSON.stringify(expectedPredicates),
              correct: actual === family.expected,
              model,
              reasoning,
              seed,
              raw: response.content,
              thinking: response.thinking,
              contentLength: response.content.length,
              thinkingLength: response.thinking.length,
              usage: response.usage,
            });
          }
        }
}

const projected = toProjectedBlindRuns(runs);
const directRuns = JSON.parse(
  await readFile(
    path.join(packageRoot, "results", directExperiment, "runs.json"),
    "utf8",
  ),
) as BlindRun[];
const selectedDirect = directRuns.filter(
  (run) =>
    run.promptVariant === "original" &&
    experiment.models.includes(run.model) &&
    experiment.reasoning.includes(run.reasoning) &&
    experiment.seeds.includes(run.seed),
);
const predicateSummary = summarizePredicates(runs);
const projectedSummary = summarizeBlindRuns(
  projected,
  dataset,
  experiment.bootstrapSamples,
);
const comparison = compareDirectAndPredicate(
  selectedDirect,
  runs,
  dataset,
  experiment.bootstrapSamples,
);
await mkdir(resultsRoot, { recursive: true });
if (!rescoreOnly)
  await writeFile(
    path.join(resultsRoot, "runs.json"),
    `${JSON.stringify(runs, null, 2)}\n`,
    "utf8",
  );
await writeFile(
  path.join(resultsRoot, "predicate-summary.json"),
  `${JSON.stringify(predicateSummary, null, 2)}\n`,
  "utf8",
);
await writeFile(
  path.join(resultsRoot, "projected-summary.json"),
  `${JSON.stringify(projectedSummary, null, 2)}\n`,
  "utf8",
);
await writeFile(
  path.join(resultsRoot, "direct-vs-predicate.json"),
  `${JSON.stringify(comparison, null, 2)}\n`,
  "utf8",
);
console.log(
  `predicates: exact ${(predicateSummary.predicateExactVectorAccuracy * 100).toFixed(1)}%, projected e2e ${(predicateSummary.projectedEndToEndAccuracy * 100).toFixed(1)}%; direct ${(comparison.directEndToEndAccuracy * 100).toFixed(1)}%, paired delta ${(comparison.pairedDelta * 100).toFixed(1)} pp`,
);

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8"));
}

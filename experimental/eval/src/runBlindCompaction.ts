import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { buildCompactionPrompt, parseCompactionAction } from "./compaction.js";
import {
  blindDatasetSchema,
  blindExperimentSchema,
  promptVariantAgreement,
  summarizeBlindRuns,
  validateBlindDataset,
  type BlindRun,
} from "./blindCompaction.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
loadEnv({ path: path.resolve(packageRoot, "../../.env") });
const args = process.argv.slice(2);
const experimentName =
  args.find((argument) => !argument.startsWith("--")) ??
  "compaction-blind-baseline-v1";
const validateOnly = args.includes("--validate-only");
if (!/^[a-zA-Z0-9._-]+$/.test(experimentName))
  throw new Error("Unsafe experiment name");

const experiment = blindExperimentSchema.parse(
  await readJson(
    path.join(packageRoot, "experiments", `${experimentName}.json`),
  ),
);
const dataset = blindDatasetSchema.parse(
  await readJson(path.join(packageRoot, "cases", `${experiment.dataset}.json`)),
);
validateBlindDataset(dataset);
if (dataset.promptVersion !== experiment.promptVersion)
  throw new Error("Dataset and experiment prompt versions differ");
const caseCount = dataset.families.reduce(
  (sum, family) => sum + family.variants.length,
  0,
);
const planned =
  caseCount *
  experiment.models.length *
  experiment.reasoning.length *
  experiment.seeds.length *
  experiment.promptVariants.length;
if (validateOnly) {
  console.log(
    `Validated ${dataset.families.length} families / ${caseCount} blind cases / ${dataset.sensitivityPairs.length * 4} sensitivity pairs; planned runs: ${planned}`,
  );
  process.exit(0);
}

const { runOllama } = await import("./ollama.js");
const runs: BlindRun[] = [];
for (const promptVariant of experiment.promptVariants)
  for (const model of experiment.models)
    for (const reasoning of experiment.reasoning)
      for (const seed of experiment.seeds)
        for (const family of dataset.families)
          for (const variant of family.variants) {
            const fixture = {
              id: `${family.id}/${variant.id}`,
              expected: family.expected,
              messages: variant.messages,
            };
            const response = await runOllama({
              model,
              prompt: buildCompactionPrompt(fixture, promptVariant),
              reasoning,
              think: experiment.think,
              seed,
              generationOptions: experiment.generationOptions,
              baseUrl: process.env.OLLAMA_BASE_URL,
              apiKey: process.env.OLLAMA_API_KEY,
            });
            const actual = parseCompactionAction(response.content);
            runs.push({
              caseId: fixture.id,
              family: family.id,
              variant: variant.id,
              domain: variant.domain,
              language: variant.language,
              expected: family.expected,
              actual,
              completed: response.content.length > 0,
              labelValid: actual !== null,
              correct: actual === family.expected,
              promptVariant,
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

const summary = summarizeBlindRuns(runs, dataset, experiment.bootstrapSamples);
const agreement = promptVariantAgreement(runs);
const resultsRoot = path.join(packageRoot, "results", experimentName);
await mkdir(resultsRoot, { recursive: true });
await writeFile(
  path.join(resultsRoot, "runs.json"),
  `${JSON.stringify(runs, null, 2)}\n`,
  "utf8",
);
await writeFile(
  path.join(resultsRoot, "summary.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
  "utf8",
);
await writeFile(
  path.join(resultsRoot, "prompt-variant-agreement.json"),
  `${JSON.stringify(agreement, null, 2)}\n`,
  "utf8",
);
for (const cell of summary) {
  console.log(
    `${cell.promptVariant}: cases ${(cell.caseAccuracy * 100).toFixed(1)}%, strict families ${(cell.strictFamilyAccuracy * 100).toFixed(1)}%, sensitivity ${(cell.sensitivityTransitionAccuracy * 100).toFixed(1)}%, invariance ${(cell.surfaceInvarianceRate * 100).toFixed(1)}%`,
  );
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8"));
}

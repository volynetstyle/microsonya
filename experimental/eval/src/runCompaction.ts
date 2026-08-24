import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { z } from "zod";
import {
  buildCompactionPrompt,
  compactionFixtureSchema,
  parseCompactionAction,
} from "./compaction.js";
import { reasoningSchema } from "./types.js";

const generationOptionsSchema = z
  .object({
    temperature: z.number().nonnegative().optional(),
    topK: z.number().int().positive().optional(),
    topP: z.number().min(0).max(1).optional(),
    minP: z.number().min(0).max(1).optional(),
    numPredict: z.number().int().positive().optional(),
    repeatPenalty: z.number().positive().optional(),
    presencePenalty: z.number().optional(),
    frequencyPenalty: z.number().optional(),
    stop: z.array(z.string()).optional(),
  })
  .strict();

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
loadEnv({ path: path.resolve(packageRoot, "../../.env") });
const args = process.argv.slice(2);
const experimentName = args[0] ?? "compaction-boundaries-v1";
const validateOnly = args.includes("--validate-only");
if (!/^[a-zA-Z0-9._-]+$/.test(experimentName))
  throw new Error("Unsafe experiment name");

const experiment = z
  .object({
    fixture: z.string().min(1),
    models: z.array(z.string()).min(1),
    reasoning: z.array(reasoningSchema).min(1),
    think: z.union([reasoningSchema, z.boolean()]).default(false),
    generationOptions: generationOptionsSchema,
    seeds: z.array(z.number().int()).min(1),
    promptVersion: z.literal("v10"),
  })
  .strict()
  .parse(
    await readJson(
      path.join(packageRoot, "experiments", `${experimentName}.json`),
    ),
  );
const fixtures = compactionFixtureSchema.parse(
  await readJson(path.join(packageRoot, "cases", `${experiment.fixture}.json`)),
);
if (new Set(fixtures.map((fixture) => fixture.id)).size !== fixtures.length)
  throw new Error("Fixture IDs must be unique");
const planned =
  fixtures.length *
  experiment.models.length *
  experiment.reasoning.length *
  experiment.seeds.length;
if (validateOnly) {
  console.log(
    `Validated ${fixtures.length} action-boundary fixtures; planned runs: ${planned}`,
  );
  process.exit(0);
}

const { runOllama } = await import("./ollama.js");
const runs = [] as Array<Record<string, unknown>>;
for (const fixture of fixtures)
  for (const model of experiment.models)
    for (const reasoning of experiment.reasoning)
      for (const seed of experiment.seeds) {
        const response = await runOllama({
          model,
          reasoning,
          think: experiment.think,
          seed,
          generationOptions: experiment.generationOptions,
          prompt: buildCompactionPrompt(fixture),
          baseUrl: process.env.OLLAMA_BASE_URL,
          apiKey: process.env.OLLAMA_API_KEY,
        });
        const actual = parseCompactionAction(response.content);
        runs.push({
          fixture: fixture.id,
          expected: fixture.expected,
          actual,
          labelValid: actual !== null,
          correct: actual === fixture.expected,
          model,
          reasoning,
          think: experiment.think,
          generationOptions: experiment.generationOptions,
          seed,
          raw: response.content,
          thinking: response.thinking,
          contentLength: response.content.length,
          thinkingLength: response.thinking.length,
          usage: response.usage,
        });
      }
const correct = runs.filter((run) => run.correct).length;
const completed = runs.filter((run) => Number(run.contentLength) > 0).length;
const validLabels = runs.filter((run) => run.labelValid === true).length;
const root = path.join(packageRoot, "results", experimentName);
await mkdir(root, { recursive: true });
await writeFile(
  path.join(root, "runs.json"),
  `${JSON.stringify(runs, null, 2)}\n`,
  "utf8",
);
await writeFile(
  path.join(root, "summary.json"),
  `${JSON.stringify({ total: runs.length, completed, completionRate: completed / runs.length, validLabels, validLabelRate: completed === 0 ? 0 : validLabels / completed, correct, classificationAccuracy: validLabels === 0 ? 0 : correct / validLabels, think: experiment.think, generationOptions: experiment.generationOptions }, null, 2)}\n`,
  "utf8",
);
console.log(
  `Completion: ${completed}/${runs.length}; valid labels: ${validLabels}/${completed}; classification accuracy: ${correct}/${validLabels}`,
);

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8"));
}

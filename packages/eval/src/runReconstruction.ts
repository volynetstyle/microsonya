import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { runOllama } from "./ollama.js";
import {
  buildReconstructionPrompt,
  RECONSTRUCTION_PROMPT_VERSION,
} from "./prompts/reconstruction.js";
import {
  emptyReconstructionScore,
  parseReconstruction,
  scoreReconstruction,
  type ReconstructionOutput,
  type ReconstructionScore,
} from "./reconstruction.js";
import { serialize } from "./serializers/index.js";
import { transformMessages } from "./transform.js";
import {
  experimentSchema,
  goldSchema,
  messageSchema,
  type EvalMessage,
  type Gold,
  type Reasoning,
  type Representation,
  type Transformation,
} from "./types.js";

type ReconstructionRun = {
  task: "thread-reconstruction";
  case: string;
  model: string;
  representation: Representation;
  transformation: Transformation;
  reasoning: Reasoning;
  seed: number;
  inputHash: string;
  promptHash: string;
  promptVersion: string;
  status: "ok" | "parse_failure" | "request_failure";
  raw: string;
  thinking: string;
  parsed: ReconstructionOutput | null;
  error?: string;
  usage: { durationMs: number; [key: string]: number | string | undefined };
  metrics: ReconstructionScore;
};

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const args = parseArgs(process.argv.slice(2));
await main(args.experiment, args.overwrite, args.validateOnly);

async function main(
  experimentName: string,
  overwrite: boolean,
  validateOnly: boolean,
): Promise<void> {
  const experiment = experimentSchema.parse(
    await readJson(
      path.join(packageRoot, "experiments", `${experimentName}.json`),
    ),
  );
  const cases = new Map<string, { messages: EvalMessage[]; gold: Gold }>();
  for (const caseName of experiment.cases)
    cases.set(caseName, await loadCase(caseName));
  const planned =
    experiment.cases.length *
    experiment.models.length *
    experiment.representations.length *
    experiment.transformations.length *
    experiment.reasoning.length *
    experiment.seeds.length;
  if (validateOnly) {
    console.log(
      `Validated ${cases.size} reconstruction cases; planned runs: ${planned}`,
    );
    return;
  }

  const root = path.join(
    packageRoot,
    "results",
    experimentName,
    "reconstruction",
  );
  const runs: ReconstructionRun[] = [];
  for (const [caseName, fixture] of cases) {
    for (const transformation of experiment.transformations) {
      const messages = transformMessages(fixture.messages, transformation);
      for (const model of experiment.models) {
        for (const representation of experiment.representations) {
          const serialized = serialize(representation, messages);
          const prompt = buildReconstructionPrompt(serialized, representation);
          for (const reasoning of experiment.reasoning) {
            for (const seed of experiment.seeds) {
              const outputPath = path.join(
                root,
                caseName,
                safe(model),
                representation,
                transformation,
                reasoning,
                `seed-${seed}.json`,
              );
              const inputHash = hash(JSON.stringify(messages));
              const promptHash = hash(prompt);
              const existing = await readExisting(outputPath);
              if (existing && !overwrite) {
                if (
                  existing.inputHash !== inputHash ||
                  existing.promptHash !== promptHash
                )
                  throw new Error(`Stale reconstruction result: ${outputPath}`);
                runs.push(existing);
                continue;
              }
              console.log(
                `Reconstructing ${caseName} | ${transformation} | ${model} | ${representation} | seed ${seed}`,
              );
              const base = {
                task: "thread-reconstruction" as const,
                case: caseName,
                model,
                representation,
                transformation,
                reasoning,
                seed,
                inputHash,
                promptHash,
                promptVersion: RECONSTRUCTION_PROMPT_VERSION,
              };
              let run: ReconstructionRun;
              try {
                const response = await runOllama({
                  model,
                  prompt,
                  reasoning,
                  seed,
                  baseUrl: process.env.OLLAMA_BASE_URL,
                  apiKey: process.env.OLLAMA_API_KEY,
                });
                const parsed = parseReconstruction(response.content);
                run = parsed.ok
                  ? {
                      ...base,
                      status: "ok",
                      raw: response.content,
                      thinking: response.thinking,
                      parsed: parsed.output,
                      usage: response.usage,
                      metrics: scoreReconstruction(
                        parsed.output,
                        fixture.gold,
                        new Set(messages.map((message) => message.id)),
                      ),
                    }
                  : {
                      ...base,
                      status: "parse_failure",
                      raw: response.content,
                      thinking: response.thinking,
                      parsed: null,
                      error: parsed.error,
                      usage: response.usage,
                      metrics: emptyReconstructionScore(parsed.validJson),
                    };
              } catch (error) {
                run = {
                  ...base,
                  status: "request_failure",
                  raw: "",
                  thinking: "",
                  parsed: null,
                  error: error instanceof Error ? error.message : String(error),
                  usage: { durationMs: 0 },
                  metrics: emptyReconstructionScore(),
                };
              }
              await mkdir(path.dirname(outputPath), { recursive: true });
              await writeFile(
                outputPath,
                `${JSON.stringify(run, null, 2)}\n`,
                "utf8",
              );
              runs.push(run);
            }
          }
        }
      }
    }
  }
  await writeFile(path.join(root, "results.csv"), runsCsv(runs), "utf8");
  await writeFile(path.join(root, "aggregate.csv"), aggregateCsv(runs), "utf8");
  await writeFile(path.join(root, "paired.csv"), pairedCsv(runs), "utf8");
  console.table(
    runs.map((run) => ({
      case: run.case,
      transform: run.transformation,
      seed: run.seed,
      status: run.status,
      pairRecall: format(run.metrics.pairwiseThreadRecall),
      pairPrecision: format(run.metrics.pairwiseThreadPrecision),
      coverage: format(run.metrics.messageCoverage),
    })),
  );
  console.log(`Reconstruction results: ${root}`);
}

async function loadCase(
  caseName: string,
): Promise<{ messages: EvalMessage[]; gold: Gold }> {
  const root = path.join(packageRoot, "cases", caseName);
  return {
    messages: z
      .array(messageSchema)
      .min(1)
      .parse(await readJson(path.join(root, "messages.json"))),
    gold: goldSchema.parse(await readJson(path.join(root, "gold.json"))),
  };
}

function runsCsv(runs: ReconstructionRun[]): string {
  const headers = [
    "case",
    "model",
    "representation",
    "transformation",
    "reasoning",
    "seed",
    "status",
    "messageCoverage",
    "unknownMessageIds",
    "duplicateAssignments",
    "pairwiseThreadPrecision",
    "pairwiseThreadRecall",
    "majorThreadRecall",
    "bestThreadJaccardMean",
    "durationMs",
  ];
  return csv(
    headers,
    runs.map((run) => [
      run.case,
      run.model,
      run.representation,
      run.transformation,
      run.reasoning,
      run.seed,
      run.status,
      run.metrics.messageCoverage,
      run.metrics.unknownMessageIds,
      run.metrics.duplicateAssignments,
      run.metrics.pairwiseThreadPrecision,
      run.metrics.pairwiseThreadRecall,
      run.metrics.majorThreadRecall,
      run.metrics.bestThreadJaccardMean,
      run.usage.durationMs,
    ]),
  );
}

function aggregateCsv(runs: ReconstructionRun[]): string {
  const headers = [
    "transformation",
    "n",
    "ok",
    "pairwiseThreadPrecision",
    "pairwiseThreadRecall",
    "majorThreadRecall",
    "messageCoverage",
  ];
  const groups = new Map<string, ReconstructionRun[]>();
  for (const run of runs)
    groups.set(run.transformation, [
      ...(groups.get(run.transformation) ?? []),
      run,
    ]);
  return csv(
    headers,
    [...groups].map(([name, group]) => [
      name,
      group.length,
      group.filter((run) => run.status === "ok").length,
      avg(group.map((run) => run.metrics.pairwiseThreadPrecision)),
      avg(group.map((run) => run.metrics.pairwiseThreadRecall)),
      avg(group.map((run) => run.metrics.majorThreadRecall)),
      avg(group.map((run) => run.metrics.messageCoverage)),
    ]),
  );
}

function pairedCsv(runs: ReconstructionRun[]): string {
  const headers = ["target", "metric", "nPairs", "meanDelta"];
  const metrics = [
    "pairwiseThreadPrecision",
    "pairwiseThreadRecall",
    "majorThreadRecall",
    "bestThreadJaccardMean",
  ] as const;
  const baseline = new Map(
    runs
      .filter((run) => run.transformation === "identity")
      .map((run) => [`${run.case}:${run.seed}`, run]),
  );
  const targets = [...new Set(runs.map((run) => run.transformation))].filter(
    (item) => item !== "identity",
  );
  return csv(
    headers,
    targets.flatMap((target) =>
      metrics.flatMap((metric) => {
        const deltas = runs
          .filter((run) => run.transformation === target)
          .flatMap((run) => {
            const base = baseline.get(`${run.case}:${run.seed}`);
            const left = base?.metrics[metric];
            const right = run.metrics[metric];
            return left == null || right == null ? [] : [right - left];
          });
        return deltas.length === 0
          ? []
          : [[target, metric, deltas.length, avg(deltas)]];
      }),
    ),
  );
}

function csv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows]
    .map((row) =>
      row.map((value) => (value == null ? "" : String(value))).join(","),
    )
    .join("\n")
    .concat("\n");
}
function avg(values: Array<number | null>): number | null {
  const valid = values.filter((value): value is number => value !== null);
  return valid.length === 0
    ? null
    : valid.reduce((sum, value) => sum + value, 0) / valid.length;
}
function format(value: number | null): string {
  return value === null ? "-" : value.toFixed(2);
}
function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
function safe(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}
async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8"));
}
async function readExisting(
  filePath: string,
): Promise<ReconstructionRun | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as ReconstructionRun;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
function parseArgs(argv: string[]): {
  experiment: string;
  overwrite: boolean;
  validateOnly: boolean;
} {
  let experiment = "reconstruction-interleaving-v1";
  let overwrite = false;
  let validateOnly = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--experiment")
      experiment = argv[++index] ?? experiment;
    else if (argv[index] === "--overwrite") overwrite = true;
    else if (argv[index] === "--validate-only") validateOnly = true;
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  return { experiment, overwrite, validateOnly };
}

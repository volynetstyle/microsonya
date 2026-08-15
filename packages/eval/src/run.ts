import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { z } from "zod";
import { countTokens } from "gpt-tokenizer/encoding/o200k_harmony";
import { OllamaRequestError, runOllama } from "./ollama.js";
import { mutationOutcomes, mutationRowsToCsv } from "./mutation.js";
import {
  frontierRows,
  frontierToCsv,
  reasoningPairedToCsv,
} from "./frontier.js";
import { projectDiscourse } from "@microsonya/discourse";
import { parseDiscourseReconstruction } from "./parse.js";
import { pairedComparisons, pairedRowsToCsv } from "./paired.js";
import {
  buildSummarizerPrompt,
  SUMMARIZER_PROMPT_VERSION,
} from "./prompts/summarizer.js";
import {
  aggregateRuns,
  aggregatesToCsv,
  printAggregateTable,
  printRunTable,
  runsToCsv,
  stagesToCsv,
} from "./report.js";
import { emptyScore, scoreSummary } from "./score.js";
import { serialize } from "./serializers/index.js";
import { transformMessages } from "./transform.js";
import {
  experimentSchema,
  goldSchema,
  messageSchema,
  type EvalMessage,
  type Experiment,
  type Gold,
  type Reasoning,
  type Representation,
  type StoredRun,
  type Transformation,
} from "./types.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const args = parseArgs(process.argv.slice(2));

await main(args.experiment, args.overwrite, args.validateOnly);

async function main(
  experimentName: string,
  overwrite: boolean,
  validateOnly: boolean,
): Promise<void> {
  const experimentPath = path.join(
    packageRoot,
    "experiments",
    `${experimentName}.json`,
  );
  const experiment = experimentSchema.parse(await readJson(experimentPath));
  for (const mutation of experiment.mutations) {
    if (
      !experiment.cases.includes(mutation.baselineCase) ||
      !experiment.cases.includes(mutation.mutantCase)
    ) {
      throw new Error(
        `Mutation ${mutation.id} references cases outside the experiment`,
      );
    }
  }
  if (experiment.promptVersion !== SUMMARIZER_PROMPT_VERSION) {
    throw new Error(
      `Experiment requests prompt ${experiment.promptVersion}, but runner provides ${SUMMARIZER_PROMPT_VERSION}`,
    );
  }

  if (validateOnly) {
    for (const caseName of experiment.cases) await loadCase(caseName);
    const runCount =
      experiment.cases.length *
      experiment.models.length *
      experiment.representations.length *
      experiment.reasoning.length *
      experiment.seeds.length *
      experiment.transformations.length;
    console.log(
      `Validated ${experiment.cases.length} canonical cases; planned runs: ${runCount}`,
    );
    return;
  }

  const resultsRoot = path.join(packageRoot, "results", experimentName);
  await mkdir(resultsRoot, { recursive: true });
  const runs: StoredRun[] = [];

  for (const caseName of experiment.cases) {
    const { messages: canonicalMessages, gold } = await loadCase(caseName);
    for (const transformation of experiment.transformations) {
      const messages = transformMessages(canonicalMessages, transformation);
      for (const model of experiment.models) {
        for (const representation of experiment.representations) {
          for (const reasoning of experiment.reasoning) {
            for (const seed of experiment.seeds) {
              const outputPath = resultPath(
                resultsRoot,
                caseName,
                model,
                representation,
                reasoning,
                seed,
                transformation,
              );
              const prepared = prepareRun(
                messages,
                model,
                representation,
                reasoning,
                seed,
                experiment,
              );
              const existing = await readExisting(outputPath);
              if (existing && !overwrite) {
                assertSameInputs(
                  existing,
                  prepared.inputHash,
                  prepared.promptHash,
                );
                runs.push(existing);
                continue;
              }

              console.log(
                `Running ${caseName} | ${transformation} | ${model} | ${representation} | ${reasoning} | seed ${seed}`,
              );
              const run = await executeRun(
                caseName,
                model,
                representation,
                reasoning,
                seed,
                transformation,
                prepared,
                messages,
                gold,
              );
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

  const aggregates = aggregateRuns(runs);
  await writeFile(
    path.join(resultsRoot, "results.csv"),
    runsToCsv(runs),
    "utf8",
  );
  await writeFile(
    path.join(resultsRoot, "aggregate.csv"),
    aggregatesToCsv(aggregates),
    "utf8",
  );
  await writeFile(
    path.join(resultsRoot, "paired.csv"),
    pairedRowsToCsv(pairedComparisons(runs, experiment)),
    "utf8",
  );
  await writeFile(
    path.join(resultsRoot, "stages.csv"),
    stagesToCsv(runs),
    "utf8",
  );
  await writeFile(
    path.join(resultsRoot, "mutations.csv"),
    mutationRowsToCsv(mutationOutcomes(runs, experiment)),
    "utf8",
  );
  await writeFile(
    path.join(resultsRoot, "frontier.csv"),
    frontierToCsv(frontierRows(runs)),
    "utf8",
  );
  await writeFile(
    path.join(resultsRoot, "reasoning-paired.csv"),
    reasoningPairedToCsv(runs),
    "utf8",
  );
  printRunTable(runs);
  printAggregateTable(aggregates);
  console.log(`Results: ${resultsRoot}`);
}

function prepareRun(
  messages: EvalMessage[],
  model: string,
  representation: Representation,
  reasoning: Reasoning,
  seed: number,
  experiment: Experiment,
): {
  prompt: string;
  inputHash: string;
  promptHash: string;
  promptVersion: string;
} {
  const serialized = serialize(representation, messages);
  const prompt = buildSummarizerPrompt(serialized, representation);
  return {
    prompt,
    inputHash: hash(JSON.stringify(messages)),
    promptHash: hash(prompt),
    promptVersion: experiment.promptVersion,
  };
}

async function executeRun(
  caseName: string,
  model: string,
  representation: Representation,
  reasoning: Reasoning,
  seed: number,
  transformation: Transformation,
  prepared: ReturnType<typeof prepareRun>,
  messages: EvalMessage[],
  gold: Gold,
): Promise<StoredRun> {
  const base = {
    case: caseName,
    model,
    representation,
    reasoning,
    seed,
    transformation,
    inputHash: prepared.inputHash,
    promptHash: prepared.promptHash,
    promptVersion: prepared.promptVersion,
  };

  try {
    const response = await runOllama({
      model,
      prompt: prepared.prompt,
      reasoning,
      seed,
      baseUrl: process.env.OLLAMA_BASE_URL,
      apiKey: process.env.OLLAMA_API_KEY,
    });
    const parsed = parseDiscourseReconstruction(response.content);
    if (!parsed.schemaValid) {
      return {
        ...base,
        status: "parse_failure",
        raw: response.content,
        thinking: response.thinking,
        parsed: null,
        parseError: parsed.error,
        usage: response.usage,
        metrics: emptyScore(parsed.validJson, false),
      };
    }

    const projection = projectDiscourse(parsed.parsed);
    return {
      ...base,
      status: "ok",
      raw: response.content,
      thinking: response.thinking,
      parsed: projection.summary,
      reconstruction: parsed.parsed,
      projectionDiagnostics: projection.diagnostics,
      usage: response.usage,
      metrics: scoreSummary(
        projection.summary,
        gold,
        new Set(messages.map((message) => message.id)),
      ),
    };
  } catch (error) {
    const requestError =
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : String(error);
    return {
      ...base,
      status: "request_failure",
      raw: error instanceof OllamaRequestError ? error.responseBody : "",
      thinking: "",
      parsed: null,
      requestError,
      usage: {
        durationMs: error instanceof OllamaRequestError ? error.durationMs : 0,
      },
      metrics: emptyScore(),
    };
  }
}

async function loadCase(
  caseName: string,
): Promise<{ messages: EvalMessage[]; gold: Gold }> {
  const caseRoot = path.join(packageRoot, "cases", caseName);
  const messages = z
    .array(messageSchema)
    .min(1)
    .parse(await readJson(path.join(caseRoot, "messages.json")));
  const ids = new Set<number>();
  for (const message of messages) {
    if (ids.has(message.id))
      throw new Error(`${caseName}: duplicate message #${message.id}`);
    ids.add(message.id);
    if (message.replyTo != null && !ids.has(message.replyTo)) {
      throw new Error(
        `${caseName}: message #${message.id} replies to missing or later #${message.replyTo}`,
      );
    }
  }
  const gold = goldSchema.parse(
    await readJson(path.join(caseRoot, "gold.json")),
  );
  for (const item of [
    ...gold.claims,
    ...gold.decisions,
    ...gold.openQuestions,
  ]) {
    for (const evidenceId of item.evidence) {
      if (!ids.has(evidenceId)) {
        throw new Error(
          `${caseName}: gold ${item.id} cites missing #${evidenceId}`,
        );
      }
    }
  }
  return { messages, gold };
}

function resultPath(
  root: string,
  caseName: string,
  model: string,
  representation: Representation,
  reasoning: Reasoning,
  seed: number,
  transformation: Transformation,
): string {
  const base = path.join(
    root,
    caseName,
    safePathPart(model),
    representation,
    reasoning,
  );
  return path.join(
    base,
    ...(transformation === "identity"
      ? []
      : ["transformation", transformation]),
    `seed-${seed}.json`,
  );
}

async function readExisting(filePath: string): Promise<StoredRun | null> {
  try {
    const run = JSON.parse(await readFile(filePath, "utf8")) as StoredRun;
    run.usage.thinkingTextTokenCount ??= countTokens(run.thinking);
    run.usage.finalTextTokenCount ??= countTokens(run.raw);
    return run;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    throw error;
  }
}

function assertSameInputs(
  run: StoredRun,
  inputHash: string,
  promptHash: string,
): void {
  if (run.inputHash !== inputHash || run.promptHash !== promptHash) {
    throw new Error(
      "An existing result was produced from different input or prompt. Use --overwrite or rename the experiment.",
    );
  }
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safePathPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function parseArgs(argv: string[]): {
  experiment: string;
  overwrite: boolean;
  validateOnly: boolean;
} {
  let experiment = "representation-v1";
  let overwrite = false;
  let validateOnly = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--overwrite") {
      overwrite = true;
    } else if (argument === "--validate-only") {
      validateOnly = true;
    } else if (argument === "--experiment") {
      const value = argv[index + 1];
      if (!value) throw new Error("--experiment requires a value");
      experiment = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(experiment)) {
    throw new Error("Experiment name contains unsafe path characters");
  }
  return { experiment, overwrite, validateOnly };
}

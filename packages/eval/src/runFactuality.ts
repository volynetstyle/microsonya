import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  buildFactualityPrompt,
  parseFactuality,
  scoreFactuality,
  type FactualityOutput,
} from "./factuality.js";
import { runOllama, type OllamaResult } from "./ollama.js";
import {
  messageSchema,
  reasoningSchema,
  representationSchema,
  type StoredRun,
} from "./types.js";

const configSchema = z
  .object({
    sourceExperiment: z.string().min(1),
    cases: z.array(z.string().min(1)).min(1),
    sourceModel: z.string().min(1),
    sourceRepresentation: representationSchema,
    sourceReasoning: reasoningSchema,
    sourceSeeds: z.array(z.number().int()).min(1),
    variants: z
      .array(z.enum(["original", "rotated-evidence"]))
      .min(1)
      .default(["original"]),
    judgeModel: z.string().min(1),
    judgeReasoning: reasoningSchema,
    judgePromptVersion: z.literal("qa-factuality-v1"),
  })
  .strict();

type FactualityRun = {
  case: string;
  sourceExperiment: string;
  sourceModel: string;
  sourceRepresentation: string;
  sourceReasoning: string;
  sourceSeed: number;
  variant: "original" | "rotated-evidence";
  judgeModel: string;
  judgeReasoning: string;
  promptVersion: string;
  sourceRunHash: string;
  promptHash: string;
  status: "ok" | "parse_failure" | "request_failure";
  raw: string;
  thinking: string;
  parsed: FactualityOutput | null;
  error?: string;
  usage: OllamaResult["usage"];
  metrics: {
    nItems: number;
    supportedRate: number | null;
    qaAgreementRate: number | null;
    contradictedRate: number | null;
    insufficientRate: number | null;
    labelValidRate: number | null;
  };
};

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const args = parseArgs(process.argv.slice(2));
await main(args.experiment, args.overwrite, args.validateOnly);

async function main(
  experimentName: string,
  overwrite: boolean,
  validateOnly: boolean,
): Promise<void> {
  const config = configSchema.parse(
    await readJson(
      path.join(packageRoot, "experiments", `${experimentName}.json`),
    ),
  );
  const planned =
    config.cases.length * config.sourceSeeds.length * config.variants.length;
  if (validateOnly) {
    for (const caseName of config.cases) {
      await loadMessages(caseName);
      for (const seed of config.sourceSeeds)
        await loadSourceRun(config, caseName, seed);
    }
    console.log(
      `Validated ${config.cases.length} factuality cases; planned judge runs: ${planned}`,
    );
    return;
  }

  const root = path.join(packageRoot, "results", experimentName, "factuality");
  const runs: FactualityRun[] = [];
  for (const caseName of config.cases) {
    const messages = await loadMessages(caseName);
    for (const sourceSeed of config.sourceSeeds) {
      const source = await loadSourceRun(config, caseName, sourceSeed);
      if (source.status !== "ok" || !source.parsed)
        throw new Error(
          `Source run is not usable: ${caseName} seed ${sourceSeed}`,
        );
      for (const variant of config.variants) {
        const prepared = buildFactualityPrompt(
          source.parsed,
          messages,
          variant,
        );
        const sourceRunHash = hash(JSON.stringify(source));
        const promptHash = hash(prepared.prompt);
        const outputPath = path.join(
          root,
          caseName,
          ...(variant === "original" ? [] : [variant]),
          `seed-${sourceSeed}.json`,
        );
        const existing = await readExisting(outputPath);
        if (existing && !overwrite) {
          if (
            existing.sourceRunHash !== sourceRunHash ||
            existing.promptHash !== promptHash
          )
            throw new Error(`Stale factuality result: ${outputPath}`);
          const reparsed = existing.raw
            ? parseFactuality(existing.raw, prepared.itemCount)
            : null;
          const resumed =
            reparsed?.ok === true
              ? {
                  ...existing,
                  variant: existing.variant ?? variant,
                  status: "ok" as const,
                  parsed: reparsed.output,
                  error: undefined,
                  metrics: scoreFactuality(reparsed.output),
                }
              : { ...existing, variant: existing.variant ?? variant };
          if (reparsed?.ok === true) {
            await writeFile(
              outputPath,
              `${JSON.stringify(resumed, null, 2)}\n`,
              "utf8",
            );
          }
          runs.push(resumed);
          continue;
        }
        console.log(
          `QA factuality ${caseName} | ${variant} | source seed ${sourceSeed} | ${config.judgeModel}`,
        );
        const base = {
          case: caseName,
          sourceExperiment: config.sourceExperiment,
          sourceModel: config.sourceModel,
          sourceRepresentation: config.sourceRepresentation,
          sourceReasoning: config.sourceReasoning,
          sourceSeed,
          variant,
          judgeModel: config.judgeModel,
          judgeReasoning: config.judgeReasoning,
          promptVersion: config.judgePromptVersion,
          sourceRunHash,
          promptHash,
        };
        let run: FactualityRun;
        try {
          const response = await runOllama({
            model: config.judgeModel,
            prompt: prepared.prompt,
            reasoning: config.judgeReasoning,
            seed: sourceSeed,
            baseUrl: process.env.OLLAMA_BASE_URL,
            apiKey: process.env.OLLAMA_API_KEY,
          });
          const parsed = parseFactuality(response.content, prepared.itemCount);
          run = parsed.ok
            ? {
                ...base,
                status: "ok",
                raw: response.content,
                thinking: response.thinking,
                parsed: parsed.output,
                usage: response.usage,
                metrics: scoreFactuality(parsed.output),
              }
            : {
                ...base,
                status: "parse_failure",
                raw: response.content,
                thinking: response.thinking,
                parsed: null,
                error: parsed.error,
                usage: response.usage,
                metrics: emptyMetrics(prepared.itemCount),
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
            metrics: emptyMetrics(prepared.itemCount),
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
  await writeFile(path.join(root, "results.csv"), toCsv(runs), "utf8");
  console.table(
    runs.map((run) => ({
      case: run.case,
      seed: run.sourceSeed,
      variant: run.variant,
      status: run.status,
      items: run.metrics.nItems,
      supported: format(run.metrics.supportedRate),
      qaAgreement: format(run.metrics.qaAgreementRate),
      contradicted: format(run.metrics.contradictedRate),
      insufficient: format(run.metrics.insufficientRate),
      labels: format(run.metrics.labelValidRate),
    })),
  );
  console.log(`Factuality results: ${root}`);
}

async function loadMessages(caseName: string) {
  return z
    .array(messageSchema)
    .parse(
      await readJson(
        path.join(packageRoot, "cases", caseName, "messages.json"),
      ),
    );
}

async function loadSourceRun(
  config: z.infer<typeof configSchema>,
  caseName: string,
  seed: number,
): Promise<StoredRun> {
  return (await readJson(
    path.join(
      packageRoot,
      "results",
      config.sourceExperiment,
      caseName,
      safe(config.sourceModel),
      config.sourceRepresentation,
      config.sourceReasoning,
      `seed-${seed}.json`,
    ),
  )) as StoredRun;
}

function toCsv(runs: FactualityRun[]): string {
  const headers = [
    "case",
    "sourceSeed",
    "variant",
    "status",
    "nItems",
    "supportedRate",
    "qaAgreementRate",
    "contradictedRate",
    "insufficientRate",
    "labelValidRate",
    "durationMs",
  ];
  return [
    headers,
    ...runs.map((run) => [
      run.case,
      run.sourceSeed,
      run.variant,
      run.status,
      run.metrics.nItems,
      run.metrics.supportedRate,
      run.metrics.qaAgreementRate,
      run.metrics.contradictedRate,
      run.metrics.insufficientRate,
      run.metrics.labelValidRate,
      run.usage.durationMs,
    ]),
  ]
    .map((row) =>
      row.map((value) => (value == null ? "" : String(value))).join(","),
    )
    .join("\n")
    .concat("\n");
}

function emptyMetrics(nItems: number): FactualityRun["metrics"] {
  return {
    nItems,
    supportedRate: null,
    qaAgreementRate: null,
    contradictedRate: null,
    insufficientRate: null,
    labelValidRate: null,
  };
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
async function readExisting(filePath: string): Promise<FactualityRun | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as FactualityRun;
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
  let experiment = "factuality-v1";
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

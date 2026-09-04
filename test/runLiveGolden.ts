import { config as loadEnv } from "dotenv";
import { writeFile } from "node:fs/promises";
import {
  asAuthorId,
  asChatId,
  asMessageId,
  asTimestampMs,
  createConversationWindow,
  type ChatMessage,
} from "../packages/shared/src/index.js";
import { loadOllamaConfig, OllamaClient } from "../packages/model/src/index.js";
import {
  createClassifier,
  createConversationSummarizer,
  ModelOutputError,
  processWindow,
  shouldAdvanceCheckpoint,
  type ClassifierEvalRegime,
  type ModelWindowMessageRole,
} from "../packages/summarize/src/index.js";
import {
  adversarialE2E,
  goldenFixtures,
  smokeE2E,
  type E2EFixture,
  type FixtureMessage,
} from "./goldenFixtures.js";
import {
  assessAction,
  evaluateRuns,
  isAcceptedAction,
  type E2EResult,
  type EvaluationMetrics,
} from "./goldenEvaluation.js";
import {
  expandExtractionFixture,
  EXTRACTION_PLACEMENTS,
  extractionFixtures,
} from "./extractionFixtures.js";
import {
  evaluateExtraction,
  type ExtractionMetrics,
} from "./extractionEvaluation.js";
import {
  evaluatePropositions,
  type PropositionMetrics,
} from "./propositionEvaluation.js";
import { PRE_BOUNDARY_COMPACTION_DECISION_INSTRUCTIONS } from "./fixtures/preBoundaryPredicateV4.js";

loadEnv({ quiet: true });

interface LiveResult extends E2EResult {
  readonly fixtureId: string;
  readonly expectedAction: E2EFixture["expected"]["action"];
  readonly durationMs: number;
  readonly modelCalls: number;
  readonly classifierCalls: number;
  readonly summarizerCalls: number;
  readonly classifierLatencyMs: number;
  readonly classifierPromptTokens: number;
  readonly schemaMismatch: boolean;
  readonly classifierEvidence?: ClassifierEvidence;
  readonly missingRequired: readonly string[];
  readonly forbiddenClaims: readonly string[];
  readonly extractionMetrics?: ExtractionMetrics;
  readonly propositionMetrics?: PropositionMetrics;
  readonly error?: string;
  readonly modelOutputPreview?: string;
}

interface ClassifierEvidence {
  readonly durable: boolean;
  readonly essentialReferentsResolved: boolean | null;
  readonly visiblyIncomplete: boolean | null;
  readonly requiresSynthesis: boolean | null;
}

interface FixtureReport {
  readonly fixtureId: string;
  readonly scope: "semantic" | "system";
  readonly status: "accepted" | "under_review";
  readonly expectedAction: E2EFixture["expected"]["action"];
  readonly runs: readonly LiveResult[];
  readonly metrics: EvaluationMetrics;
}

const EXEMPLAR_ORDERS: Readonly<Record<string, readonly number[]>> = {
  E0: [0, 1, 2, 3, 4],
  E1: [4, 3, 2, 1, 0],
  E2: [1, 2, 3, 4, 0],
  E3: [2, 0, 4, 1, 3],
  E4: [3, 1, 4, 0, 2],
  E5: [4, 0, 2, 3, 1],
};

const args = parseArgs(process.argv.slice(2));
const ollamaConfig = loadOllamaConfig(process.env);
const endpoint = ollamaConfig.baseUrl ?? "http://localhost:11434/api";

if (endpoint.includes("localhost") && !process.env.OLLAMA_API_KEY) {
  throw new Error(
    "Live cloud evaluation requires OLLAMA_HOST=https://ollama.com and OLLAMA_API_KEY.",
  );
}

const client = new OllamaClient(ollamaConfig);
const selected = selectFixtures(args);
const reports: FixtureReport[] = [];

for (const fixture of selected) {
  const runs: LiveResult[] = [];
  for (let index = 0; index < args.runs; index += 1) {
    runs.push(
      await runFixture(
        fixture,
        client,
        args.timeoutMs,
        args.model,
        args.seed + index,
        args.summarizerOnly,
        args.classifierOnly,
        args.generationPath,
        args.classifierRegime,
        args.exemplarOrder,
        args.exemplarMode,
        args.evalPolicyOverride,
      ),
    );
    if (!args.json) {
      const result = runs.at(-1)!;
      const marker = result.error
        ? "ERROR"
        : fixture.scope === "system"
          ? "SYSTEM"
          : fixture.status === "under_review"
            ? "REVIEW"
            : isPassingResult(result)
              ? "PASS"
              : "FAIL";
      process.stderr.write(
        `${marker} ${fixture.id} ${index + 1}/${args.runs}: ${result.action} (${Math.round(result.durationMs)}ms, ${result.modelCalls} calls)\n`,
      );
    }
  }
  reports.push({
    fixtureId: fixture.id,
    scope: fixture.scope ?? "semantic",
    status: fixture.status ?? "accepted",
    expectedAction: fixture.expected.action,
    runs,
    metrics: evaluateRuns(fixture, runs),
  });
}

const totals = aggregate(reports);
const report = {
  generatedAt: new Date().toISOString(),
  model: args.model,
  endpoint: redactEndpoint(endpoint),
  suite: args.suite,
  generationPath: args.generationPath,
  classifierRegime: args.classifierRegime,
  exemplarOrder: args.exemplarOrderName,
  classifierExemplars: args.classifierExemplars,
  seed: args.seed,
  summarizerOnly: args.summarizerOnly,
  classifierOnly: args.classifierOnly,
  reports,
  totals,
};

const serializedReport = `${JSON.stringify(report, null, 2)}\n`;
if (args.output) await writeFile(args.output, serializedReport, "utf8");
if (!args.output || !args.json) process.stdout.write(serializedReport);

if (!totals.releaseGate.passed) process.exitCode = 1;

async function runFixture(
  fixture: E2EFixture,
  ollama: OllamaClient,
  timeoutMs: number,
  model: string,
  seed: number,
  summarizerOnly: boolean,
  classifierOnly: boolean,
  generationPath: SummaryGenerationPath,
  classifierRegime: ClassifierEvalRegime,
  exemplarOrder: readonly number[] | undefined,
  exemplarMode: "current" | "none" | "hardest",
  evalPolicyOverride: string | undefined,
): Promise<LiveResult> {
  const startedAt = performance.now();
  let modelCalls = 0;
  let classifierCalls = 0;
  let summarizerCalls = 0;
  let classifierLatencyMs = 0;
  let classifierPromptTokens = 0;
  let classifierEvidence: ClassifierEvidence | undefined;
  const countedClient = (kind: "classifier" | "summarizer") => ({
    chat: async (...chatArgs: Parameters<OllamaClient["chat"]>) => {
      modelCalls += 1;
      if (kind === "classifier") classifierCalls += 1;
      else summarizerCalls += 1;
      const [request, options] = chatArgs;
      const callStartedAt = performance.now();
      const response = (await ollama.chat(
        {
          ...request,
          model,
          options: { ...request.options, seed },
        },
        options,
      )) as unknown as {
        readonly prompt_eval_count?: number;
        readonly message?: { readonly content?: string };
      };
      if (kind === "classifier") {
        classifierLatencyMs += performance.now() - callStartedAt;
        classifierPromptTokens += response.prompt_eval_count ?? 0;
        classifierEvidence = parseClassifierEvidence(
          response.message?.content,
          classifierRegime,
        );
      }
      return response as never;
    },
  });

  if (fixture.messages.length === 0) {
    return {
      fixtureId: fixture.id,
      expectedAction: fixture.expected.action,
      action: "EMPTY",
      checkpointAdvanced: false,
      durationMs: performance.now() - startedAt,
      modelCalls,
      classifierCalls,
      summarizerCalls,
      classifierLatencyMs,
      classifierPromptTokens,
      schemaMismatch: false,
      missingRequired: [],
      forbiddenClaims: [],
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const materialized = materializeFixture(fixture);
    const window = createConversationWindow(materialized.messages);
    const classifier = summarizerOnly
      ? {
          classify: async () => ({
            action: "SUMMARIZE" as const,
            evidence: {
              source: "deterministic" as const,
              rule: "live-eval-summarizer-only",
            },
          }),
        }
      : createClassifier(
          { ollama: countedClient("classifier") as never },
          {
            evalRegime: classifierRegime,
            exemplarOrder,
            exemplarMode,
            evalPolicyOverride,
          },
        );
    if (classifierOnly) {
      const decision = await classifier.classify(
        window,
        controller.signal,
        undefined,
        materialized.roles,
      );
      return {
        fixtureId: fixture.id,
        expectedAction: fixture.expected.action,
        action: decision.action,
        checkpointAdvanced: shouldAdvanceCheckpoint(decision.action),
        durationMs: performance.now() - startedAt,
        modelCalls,
        classifierCalls,
        summarizerCalls,
        classifierLatencyMs,
        classifierPromptTokens,
        schemaMismatch: false,
        classifierEvidence,
        missingRequired: [],
        forbiddenClaims: [],
      };
    }
    const result = await processWindow(
      window,
      {
        classifier,
        summarizer: createConversationSummarizer({
          ollama: countedClient("summarizer") as never,
        }),
        roles: materialized.roles,
        ...(generationPath === "production"
          ? { progressive: createProductionParityCollector() }
          : {}),
      },
      controller.signal,
    );
    const summary =
      result.disposition.kind === "summarized"
        ? result.disposition.summary.text
        : undefined;
    const constraints = evaluateSummaryConstraints(fixture, summary);
    const extractionFixture = findExtractionFixture(fixture.id);
    const propositionMetrics = evaluatePropositions(fixture.id, summary);

    return {
      fixtureId: fixture.id,
      expectedAction: fixture.expected.action,
      action: result.decision.action,
      summary,
      checkpointAdvanced: shouldAdvanceCheckpoint(result.decision.action),
      durationMs: performance.now() - startedAt,
      modelCalls,
      classifierCalls,
      summarizerCalls,
      classifierLatencyMs,
      classifierPromptTokens,
      schemaMismatch: false,
      classifierEvidence,
      ...constraints,
      ...(extractionFixture
        ? { extractionMetrics: evaluateExtraction(extractionFixture, summary) }
        : {}),
      ...(propositionMetrics ? { propositionMetrics } : {}),
    };
  } catch (error) {
    return {
      fixtureId: fixture.id,
      expectedAction: fixture.expected.action,
      action: "EMPTY",
      checkpointAdvanced: false,
      durationMs: performance.now() - startedAt,
      modelCalls,
      classifierCalls,
      summarizerCalls,
      classifierLatencyMs,
      classifierPromptTokens,
      schemaMismatch:
        error instanceof ModelOutputError &&
        error.code === "MODEL_OUTPUT_SCHEMA_MISMATCH",
      classifierEvidence,
      missingRequired: fixture.expected.summary?.mustInclude ?? [],
      forbiddenClaims: [],
      error:
        error instanceof Error
          ? `${error.name}: ${error.message}`
          : String(error),
      ...(error instanceof ModelOutputError
        ? { modelOutputPreview: error.outputPreview }
        : {}),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function message(
  id: number,
  value: string | FixtureMessage,
  all?: readonly (string | FixtureMessage)[],
): ChatMessage {
  const fixture =
    typeof value === "string"
      ? { text: value, author: `Participant ${(id % 3) + 1}` }
      : value;
  const replyTo = fixture.replyTo;
  if (
    replyTo !== undefined &&
    (all === undefined || replyTo < 0 || replyTo >= id - 1)
  ) {
    throw new TypeError(
      `Fixture replyTo ${replyTo} must reference an earlier message.`,
    );
  }
  return Object.freeze({
    id: asMessageId(id),
    chatId: asChatId("golden-live"),
    author: Object.freeze({
      id: asAuthorId(`fixture-author:${fixture.author}`),
      label: fixture.author,
    }),
    ...(fixture.source === undefined
      ? {}
      : {
          contentSource: Object.freeze({
            ...fixture.source,
            sourceId: `fixture-source:${fixture.source.kind}:${fixture.source.label}`,
          }),
        }),
    time: asTimestampMs(1_700_000_000_000 + id * 1_000),
    parentId: replyTo === undefined ? null : asMessageId(replyTo + 1),
    text: fixture.text,
  });
}

function materializeFixture(fixture: E2EFixture): {
  readonly messages: readonly ChatMessage[];
  readonly roles?: readonly ModelWindowMessageRole[];
} {
  if (fixture.id === "reply-crosses-checkpoint") {
    const parent = {
      ...message(100, fixture.messages[0]!),
      text: "Backend deploy is blocked by migration 42.",
    };
    const child = {
      ...message(117, fixture.messages[1]!),
      parentId: asMessageId(100),
      text: "Міграцію вже закінчили, deploy можна запускати.",
    };
    return {
      messages: [parent, child],
      roles: [
        { message: parent, role: "context" },
        { message: child, role: "eligible" },
      ],
    };
  }
  const messages = fixture.messages.map((value, index) =>
    message(index + 1, value, fixture.messages),
  );
  return {
    messages,
    roles: messages.map((value) => ({
      message: value,
      role: "eligible" as const,
    })),
  };
}

function parseClassifierEvidence(
  content: string | undefined,
  regime: ClassifierEvalRegime,
): ClassifierEvidence | undefined {
  if (!content) return undefined;
  try {
    const value = JSON.parse(content) as Record<string, unknown>;
    if (typeof value.durable !== "boolean") return undefined;
    if (["A0", "B0", "B1"].includes(regime)) {
      return {
        durable: value.durable,
        essentialReferentsResolved:
          typeof value.essentialReferentsResolved === "boolean"
            ? value.essentialReferentsResolved
            : null,
        visiblyIncomplete:
          typeof value.visiblyIncomplete === "boolean"
            ? value.visiblyIncomplete
            : null,
        requiresSynthesis:
          value.alreadyCompact === true
            ? false
            : typeof value.requiresSynthesis === "boolean"
              ? value.requiresSynthesis
              : null,
      };
    }
    return {
      durable: value.durable,
      essentialReferentsResolved:
        typeof value.essentialReferentsResolved === "boolean"
          ? value.essentialReferentsResolved
          : null,
      visiblyIncomplete:
        typeof value.visiblyIncomplete === "boolean"
          ? value.visiblyIncomplete
          : null,
      requiresSynthesis:
        typeof value.requiresSynthesis === "boolean"
          ? value.requiresSynthesis
          : null,
    };
  } catch {
    return undefined;
  }
}

function evaluateSummaryConstraints(
  fixture: E2EFixture,
  summary?: string,
): Pick<LiveResult, "missingRequired" | "forbiddenClaims"> {
  const normalized = summary?.toLocaleLowerCase() ?? "";
  const required =
    fixture.expected.summary?.exactInvariants ??
    fixture.expected.summary?.mustInclude ??
    [];
  const forbidden = [
    ...(fixture.expected.summary?.mustExclude ?? []),
    ...(fixture.expected.summary?.mustNotInvent ?? []),
  ];
  return {
    missingRequired: required.filter(
      (value) => !normalized.includes(value.toLocaleLowerCase()),
    ),
    forbiddenClaims: forbidden.filter((value) =>
      normalized.includes(value.toLocaleLowerCase()),
    ),
  };
}

function parseArgs(argv: readonly string[]) {
  const read = (name: string) => {
    const inline = argv.find((value) => value.startsWith(`${name}=`));
    if (inline) return inline.slice(name.length + 1);
    const index = argv.indexOf(name);
    return index === -1 ? undefined : argv[index + 1];
  };
  const readAll = (name: string) => {
    const values: string[] = [];
    for (let index = 0; index < argv.length; index += 1) {
      const value = argv[index]!;
      if (value.startsWith(`${name}=`)) {
        values.push(value.slice(name.length + 1));
      } else if (value === name && argv[index + 1] !== undefined) {
        values.push(argv[index + 1]!);
        index += 1;
      }
    }
    return values;
  };
  const suite = read("--suite") ?? "smoke";
  if (
    !["smoke", "adversarial", "stability", "extraction", "all"].includes(suite)
  ) {
    throw new TypeError(`Unknown suite: ${suite}`);
  }
  const runs = positiveInteger(
    read("--runs") ?? (suite === "stability" ? "20" : "1"),
    "runs",
  );
  const timeoutMs = positiveInteger(
    read("--timeout-ms") ?? "180000",
    "timeout-ms",
  );
  const minimumAccuracy = Number(read("--minimum-accuracy") ?? "0.95");
  if (minimumAccuracy < 0 || minimumAccuracy > 1) {
    throw new TypeError("minimum-accuracy must be between 0 and 1.");
  }
  const generationPath = read("--generation-path") ?? "production";
  if (!["production", "structured-diagnostic"].includes(generationPath)) {
    throw new TypeError(
      "generation-path must be production or structured-diagnostic.",
    );
  }
  const seed = nonNegativeInteger(read("--seed") ?? "0", "seed");
  if (
    argv.includes("--summarizer-only") &&
    argv.includes("--classifier-only")
  ) {
    throw new TypeError(
      "summarizer-only and classifier-only are mutually exclusive.",
    );
  }
  const classifierRegime = read("--classifier-regime") ?? "A2";
  if (!["A0", "B0", "B1", "A1", "A2"].includes(classifierRegime)) {
    throw new TypeError(`Unknown classifier regime: ${classifierRegime}`);
  }
  const exemplarOrderName = read("--exemplar-order") ?? "E0";
  const exemplarOrder = EXEMPLAR_ORDERS[exemplarOrderName];
  if (exemplarOrder === undefined) {
    throw new TypeError(`Unknown exemplar order: ${exemplarOrderName}`);
  }
  const classifierExemplars = read("--classifier-exemplars") ?? "X3";
  if (!["X0", "X1", "X2", "X3"].includes(classifierExemplars)) {
    throw new TypeError(`Unknown classifier exemplars: ${classifierExemplars}`);
  }
  return {
    suite: suite as
      | "smoke"
      | "adversarial"
      | "stability"
      | "extraction"
      | "all",
    runs,
    timeoutMs,
    minimumAccuracy,
    fixtureIds: readAll("--fixture"),
    output: read("--output"),
    json: argv.includes("--json"),
    model: read("--model") ?? "gpt-oss:120b-cloud",
    generationPath: generationPath as SummaryGenerationPath,
    seed,
    summarizerOnly: argv.includes("--summarizer-only"),
    classifierOnly: argv.includes("--classifier-only"),
    classifierRegime: classifierRegime as ClassifierEvalRegime,
    exemplarOrderName,
    exemplarOrder:
      classifierRegime === "A0" || exemplarOrderName === "E0"
        ? undefined
        : exemplarOrder,
    classifierExemplars,
    exemplarMode:
      classifierExemplars === "X1"
        ? ("none" as const)
        : classifierExemplars === "X2"
          ? ("hardest" as const)
          : ("current" as const),
    evalPolicyOverride:
      classifierExemplars === "X0"
        ? PRE_BOUNDARY_COMPACTION_DECISION_INSTRUCTIONS
        : undefined,
  };
}

/**
 * The live generation gate must exercise the same orchestrator branch as the
 * Worker: stream=true, no format, plain-text instructions, and progressive
 * collection. It has no presentation side effect, so it is safe for eval.
 */
function createProductionParityCollector() {
  let text = "";
  return {
    begin: async () => undefined,
    append: (delta: string) => {
      text += delta;
    },
    finalize: async () => text,
    fail: async () => undefined,
  };
}

type SummaryGenerationPath = "production" | "structured-diagnostic";

function selectFixtures(args: ReturnType<typeof parseArgs>): E2EFixture[] {
  const extraction = extractionFixtures.flatMap((fixture) =>
    EXTRACTION_PLACEMENTS.map((placement) =>
      expandExtractionFixture(fixture, placement),
    ),
  );
  const semanticGoldens = [...goldenFixtures];
  const available =
    args.suite === "extraction"
      ? extraction
      : [...semanticGoldens, ...extraction];
  const byId = new Map(available.map((value) => [value.id, value]));
  const ids =
    args.fixtureIds.length > 0
      ? args.fixtureIds
      : args.suite === "smoke"
        ? [...smokeE2E]
        : args.suite === "adversarial"
          ? [...adversarialE2E]
          : args.suite === "stability"
            ? [
                "live-casual-high-information-minecraft",
                "summarize-schema-fallback-lifecycle",
                "live-prod-version-vs-time",
                "banter-with-durable-technical-island",
                "long-frequency-vs-final-state@front",
                "long-frequency-vs-final-state@middle",
                "long-frequency-vs-final-state@tail",
              ]
            : args.suite === "extraction"
              ? extraction.map(({ id }) => id)
              : available.map(({ id }) => id);
  return ids.map((id) => {
    const value = byId.get(id);
    if (!value) throw new TypeError(`Unknown fixture: ${id}`);
    return value;
  });
}

function findExtractionFixture(expandedId: string) {
  const baseId = expandedId.split("@")[0];
  return extractionFixtures.find(({ id }) => id === baseId);
}

function isPassingResult(result: LiveResult): boolean {
  if (result.error) return false;
  const fixture = findFixture(result.fixtureId);
  if (!fixture || !isAcceptedAction(fixture, result.action)) return false;
  if (result.action !== "SUMMARIZE") return true;
  if (result.propositionMetrics && result.propositionMetrics.score < 1) {
    return false;
  }
  const metrics = result.extractionMetrics;
  return metrics === undefined || result.propositionMetrics !== undefined;
}

function findFixture(id: string): E2EFixture | undefined {
  const baseId = id.split("@")[0];
  const golden = goldenFixtures.find(({ id: candidate }) => candidate === id);
  if (golden) return golden;
  const extraction = extractionFixtures.find(
    ({ id: candidate }) => candidate === baseId,
  );
  const placement = id.split("@")[1];
  if (
    !extraction ||
    !EXTRACTION_PLACEMENTS.includes(
      placement as (typeof EXTRACTION_PLACEMENTS)[number],
    )
  ) {
    return undefined;
  }
  return expandExtractionFixture(
    extraction,
    placement as (typeof EXTRACTION_PLACEMENTS)[number],
  );
}

function positiveInteger(raw: string, label: string): number {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
  return value;
}

function nonNegativeInteger(raw: string, label: string): number {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer.`);
  }
  return value;
}

function redactEndpoint(baseUrl: string): string {
  const url = new URL(baseUrl);
  return `${url.protocol}//${url.host}${url.pathname}`;
}

function aggregate(reports: readonly FixtureReport[]) {
  const runs = reports.flatMap((report) => report.runs);
  const acceptedSemantic = reports.filter(
    ({ scope, status }) => scope === "semantic" && status === "accepted",
  );
  const acceptedSemanticRuns = acceptedSemantic.flatMap(({ runs }) => runs);
  const actionAssessments = reports.flatMap((report) => {
    const fixture = findFixture(report.fixtureId);
    if (!fixture || report.scope === "system") return [];
    return report.runs.map((result) => assessAction(fixture, result.action));
  });
  const errors = runs.filter((result) => result.error !== undefined).length;
  const correct = runs.filter(
    (result) => result.action === result.expectedAction && !result.error,
  ).length;
  const propositionRuns = runs.filter(
    (result) =>
      result.action === "SUMMARIZE" && result.propositionMetrics !== undefined,
  );
  const propositionPassed = propositionRuns.reduce(
    (sum, result) => sum + result.propositionMetrics!.passed,
    0,
  );
  const propositionTotal = propositionRuns.reduce(
    (sum, result) => sum + result.propositionMetrics!.total,
    0,
  );
  const policyBehaviorCorrect = acceptedSemantic.flatMap((report) => {
    const fixture = findFixture(report.fixtureId)!;
    return report.runs.filter(
      (result) => !result.error && isAcceptedAction(fixture, result.action),
    );
  }).length;
  const productSafeActionRate =
    acceptedSemanticRuns.length === 0
      ? 0
      : policyBehaviorCorrect / acceptedSemanticRuns.length;
  const propositionScore =
    propositionTotal === 0 ? null : propositionPassed / propositionTotal;
  const criticalErrors = actionAssessments.filter(
    ({ severity }) => severity === "critical",
  ).length;
  const irreversibleLosses = reports.reduce(
    (sum, report) =>
      sum + report.runs.length * report.metrics.irreversibleLossRate,
    0,
  );
  const durableFalseNegatives = acceptedSemanticRuns.filter(
    (result) =>
      isMeaningfulExpected(result.expectedAction) &&
      result.action.startsWith("SKIP_"),
  ).length;
  const durableFalsePositives = acceptedSemanticRuns.filter(
    (result) =>
      result.expectedAction.startsWith("SKIP_") &&
      isMeaningfulExpected(result.action),
  ).length;
  const unsafePrematureSummaries = actionAssessments.filter(
    ({ category }) => category === "unsafe_premature_summary",
  ).length;
  const actorAttributionRuns = runs.filter(
    ({ action, summary, propositionMetrics }) =>
      action === "SUMMARIZE" &&
      summary !== undefined &&
      propositionMetrics !== undefined,
  );
  const actorAttributionErrors = actorAttributionRuns.reduce(
    (sum, result) =>
      sum +
      (result.propositionMetrics?.errorsByType.ENTITY_BINDING ?? 0) +
      (result.propositionMetrics?.errorsByType.PROVENANCE ?? 0),
    0,
  );
  const actorAttributionEvaluatedRuns = actorAttributionRuns.length;
  const replyTargetIds = new Set(["reply-crosses-checkpoint"]);
  const replyResolutionErrors = reports
    .filter(({ fixtureId }) => replyTargetIds.has(fixtureId))
    .flatMap(({ runs }) => runs)
    .filter((result) => {
      const fixture = findFixture(result.fixtureId);
      return (
        result.error !== undefined ||
        !fixture ||
        !isAcceptedAction(fixture, result.action)
      );
    }).length;
  const schemaMismatches = runs.filter(
    ({ schemaMismatch }) => schemaMismatch,
  ).length;
  const totalWeightedCost = actionAssessments.reduce(
    (sum, assessment) => sum + assessment.cost,
    0,
  );
  const actionDistribution = Object.fromEntries(
    [...new Set(runs.map(({ action }) => action))].map((action) => [
      action,
      runs.filter((result) => result.action === action).length,
    ]),
  );
  const predicateFailureManifest = buildPredicateFailureManifest(reports);
  const releaseChecks = {
    criticalErrors: criticalErrors === 0,
    irreversibleLosses: irreversibleLosses === 0,
    durableFalseNegatives: durableFalseNegatives === 0,
    unsafePrematureSummaries: unsafePrematureSummaries === 0,
    actorAttributionErrors: actorAttributionErrors === 0,
    replyResolutionErrors: replyResolutionErrors === 0,
    providerParseFailures: errors === 0,
    productSafeActionRate: productSafeActionRate >= 0.9,
    semanticPropositionScore:
      propositionScore === null || propositionScore >= 0.9,
  };
  return {
    fixtures: reports.length,
    runs: runs.length,
    modelCalls: runs.reduce((sum, result) => sum + result.modelCalls, 0),
    classifierCalls: runs.reduce(
      (sum, result) => sum + result.classifierCalls,
      0,
    ),
    summarizerCalls: runs.reduce(
      (sum, result) => sum + result.summarizerCalls,
      0,
    ),
    telemetryInvariants: {
      callsBalance: runs.every(
        ({ modelCalls, classifierCalls, summarizerCalls }) =>
          modelCalls === classifierCalls + summarizerCalls,
      ),
      summarizerMatchesActions: runs.every(
        ({ action, summarizerCalls, error }) =>
          error !== undefined ||
          summarizerCalls ===
            (action === "SUMMARIZE" && !args.classifierOnly ? 2 : 0),
      ),
    },
    errors,
    accuracy: runs.length === 0 ? 0 : correct / runs.length,
    semanticHeadline: {
      fixtures: acceptedSemantic.length,
      runs: acceptedSemanticRuns.length,
      correct: acceptedSemanticRuns.filter(
        (result) => result.action === result.expectedAction && !result.error,
      ).length,
      accuracy:
        acceptedSemanticRuns.length === 0
          ? 0
          : acceptedSemanticRuns.filter(
              (result) =>
                result.action === result.expectedAction && !result.error,
            ).length / acceptedSemanticRuns.length,
    },
    policyBehaviorHeadline: {
      fixtures: acceptedSemantic.length,
      runs: acceptedSemanticRuns.length,
      correct: policyBehaviorCorrect,
      accuracy: productSafeActionRate,
    },
    stability: {
      mean:
        acceptedSemantic.length === 0
          ? 0
          : acceptedSemantic.reduce(
              (sum, report) => sum + report.metrics.stability,
              0,
            ) / acceptedSemantic.length,
      min:
        acceptedSemantic.length === 0
          ? 0
          : Math.min(
              ...acceptedSemantic.map(({ metrics }) => metrics.stability),
            ),
      unstableFixtureCount: acceptedSemantic.filter(
        ({ metrics }) => metrics.stability < 1,
      ).length,
    },
    semanticPropositions: {
      evaluatedSummaries: propositionRuns.length,
      passed: propositionPassed,
      total: propositionTotal,
      score: propositionScore,
      errorsByType: Object.fromEntries(
        [
          "FACT_OMISSION",
          "FACT_INVENTION",
          "ENTITY_BINDING",
          "NUMERIC_TYPE",
          "PROVENANCE",
          "SUPERSESSION",
          "EPISTEMIC_STATE",
          "SPEECH_ACT",
          "CONDITION_PRESERVATION",
        ].map((errorType) => [
          errorType,
          propositionRuns.reduce(
            (sum, result) =>
              sum +
              (result.propositionMetrics!.errorsByType[
                errorType as keyof PropositionMetrics["errorsByType"]
              ] ?? 0),
            0,
          ),
        ]),
      ),
    },
    excludedFromSemanticHeadline: {
      systemFixtures: reports.filter(({ scope }) => scope === "system").length,
      underReviewFixtures: reports.filter(
        ({ scope, status }) =>
          scope === "semantic" && status === "under_review",
      ).length,
    },
    weightedErrors: {
      totalCost: totalWeightedCost,
      meanCost:
        actionAssessments.length === 0
          ? 0
          : totalWeightedCost / actionAssessments.length,
      critical: criticalErrors,
      medium: actionAssessments.filter(({ severity }) => severity === "medium")
        .length,
      low: actionAssessments.filter(({ severity }) => severity === "low")
        .length,
      categories: Object.fromEntries(
        [...new Set(actionAssessments.map(({ category }) => category))].map(
          (category) => [
            category,
            actionAssessments.filter(
              (assessment) => assessment.category === category,
            ).length,
          ],
        ),
      ),
      costBySeverity: Object.fromEntries(
        ["critical", "medium", "low"].map((severity) => [
          severity,
          actionAssessments
            .filter((assessment) => assessment.severity === severity)
            .reduce((sum, assessment) => sum + assessment.cost, 0),
        ]),
      ),
      costByCategory: Object.fromEntries(
        [...new Set(actionAssessments.map(({ category }) => category))].map(
          (category) => [
            category,
            actionAssessments
              .filter((assessment) => assessment.category === category)
              .reduce((sum, assessment) => sum + assessment.cost, 0),
          ],
        ),
      ),
    },
    irreversibleLosses,
    classifierSafety: {
      boundarySafeRate: productSafeActionRate,
      durableFalseNegatives,
      durableFalsePositives,
      unsafePrematureSummaries,
      actorAttributionErrors,
      actorAttributionEvaluatedRuns,
      replyResolutionErrors,
      schemaMismatches,
      schemaMismatchRate:
        runs.length === 0 ? 0 : schemaMismatches / runs.length,
      actionDistribution,
      costWeightedLoss: totalWeightedCost,
      meanClassifierLatencyMs:
        runs.length === 0
          ? 0
          : runs.reduce((sum, result) => sum + result.classifierLatencyMs, 0) /
            runs.length,
      meanClassifierPromptTokens:
        runs.length === 0
          ? 0
          : runs.reduce(
              (sum, result) => sum + result.classifierPromptTokens,
              0,
            ) / runs.length,
      predicateFailureManifest,
    },
    lexicalConstraintDiagnostics: runs.reduce(
      (sum, result) =>
        sum + result.missingRequired.length + result.forbiddenClaims.length,
      0,
    ),
    releaseGate: {
      ...releaseChecks,
      passed: Object.values(releaseChecks).every(Boolean),
      thresholds: {
        productSafeActionRate: 0.9,
        semanticPropositionScore: 0.9,
      },
    },
  };
}

function buildPredicateFailureManifest(reports: readonly FixtureReport[]) {
  const order = [
    "durable",
    "essentialReferentsResolved",
    "visiblyIncomplete",
    "requiresSynthesis",
    "unavailable",
  ] as const;
  const predicateOrder: readonly (keyof ClassifierEvidence)[] = [
    "durable",
    "essentialReferentsResolved",
    "visiblyIncomplete",
    "requiresSynthesis",
  ];
  const rows = new Map<
    (typeof order)[number],
    { failures: number; safetyCost: number; fixtures: Set<string> }
  >();
  for (const predicate of order) {
    rows.set(predicate, { failures: 0, safetyCost: 0, fixtures: new Set() });
  }

  for (const report of reports) {
    const fixture = findFixture(report.fixtureId);
    if (!fixture || report.scope === "system") continue;
    for (const run of report.runs) {
      const assessment = assessAction(fixture, run.action);
      if (assessment.correct || assessment.category === "golden_under_review") {
        continue;
      }
      const expected = expectedEvidence(fixture.expected.action);
      const actual = run.classifierEvidence;
      const first = actual
        ? (predicateOrder.find((predicate) => {
            const required = expected[predicate];
            return required !== undefined && actual[predicate] !== required;
          }) ?? "unavailable")
        : "unavailable";
      const row = rows.get(first)!;
      row.failures += 1;
      row.safetyCost += assessment.cost;
      row.fixtures.add(report.fixtureId);
    }
  }

  return order.map((predicate) => {
    const row = rows.get(predicate)!;
    return {
      predicate,
      failures: row.failures,
      safetyCost: row.safetyCost,
      fixtures: [...row.fixtures],
    };
  });
}

function expectedEvidence(
  action: E2EResult["action"],
): Partial<ClassifierEvidence> {
  if (action.startsWith("SKIP_")) return { durable: false };
  if (action === "DEFER_CONTEXT") {
    return { durable: true, essentialReferentsResolved: false };
  }
  if (action === "DEFER_INCOMPLETE") {
    return {
      durable: true,
      essentialReferentsResolved: true,
      visiblyIncomplete: true,
    };
  }
  if (action === "SUMMARIZE") {
    return {
      durable: true,
      essentialReferentsResolved: true,
      visiblyIncomplete: false,
      requiresSynthesis: true,
    };
  }
  if (action === "DEFER_COMPACT") {
    return {
      durable: true,
      essentialReferentsResolved: true,
      visiblyIncomplete: false,
      requiresSynthesis: false,
    };
  }
  return {};
}

function isMeaningfulExpected(action: E2EResult["action"]): boolean {
  return action === "SUMMARIZE" || action.startsWith("DEFER_");
}

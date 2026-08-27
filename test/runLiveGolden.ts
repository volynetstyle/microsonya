import { config as loadEnv } from "dotenv";
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
  processWindow,
  shouldAdvanceCheckpoint,
} from "../packages/summarize/src/index.js";
import {
  adversarialE2E,
  goldenFixtures,
  smokeE2E,
  type E2EFixture,
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

loadEnv({ quiet: true });

interface LiveResult extends E2EResult {
  readonly fixtureId: string;
  readonly expectedAction: E2EFixture["expected"]["action"];
  readonly durationMs: number;
  readonly modelCalls: number;
  readonly classifierCalls: number;
  readonly summarizerCalls: number;
  readonly missingRequired: readonly string[];
  readonly forbiddenClaims: readonly string[];
  readonly extractionMetrics?: ExtractionMetrics;
  readonly error?: string;
}

interface FixtureReport {
  readonly fixtureId: string;
  readonly scope: "semantic" | "system";
  readonly status: "accepted" | "under_review";
  readonly expectedAction: E2EFixture["expected"]["action"];
  readonly runs: readonly LiveResult[];
  readonly metrics: EvaluationMetrics;
}

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
    runs.push(await runFixture(fixture, client, args.timeoutMs));
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

const report = {
  generatedAt: new Date().toISOString(),
  model: "gpt-oss:120b-cloud",
  endpoint: redactEndpoint(endpoint),
  suite: args.suite,
  reports,
  totals: aggregate(reports),
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

if (
  reports.some(
    ({ metrics, scope, status }) =>
      scope === "semantic" &&
      status === "accepted" &&
      (metrics.accuracy < args.minimumAccuracy ||
        metrics.irreversibleLossRate > 0 ||
        metrics.checkpointCorrectness < 1),
  ) ||
  reports.some(
    ({ runs, scope, status }) =>
      scope === "semantic" &&
      status === "accepted" &&
      runs.some((result) => !isPassingResult(result)),
  )
) {
  process.exitCode = 1;
}

async function runFixture(
  fixture: E2EFixture,
  ollama: OllamaClient,
  timeoutMs: number,
): Promise<LiveResult> {
  const startedAt = performance.now();
  let modelCalls = 0;
  let classifierCalls = 0;
  let summarizerCalls = 0;
  const countedClient = (kind: "classifier" | "summarizer") => ({
    chat: async (...chatArgs: Parameters<OllamaClient["chat"]>) => {
      modelCalls += 1;
      if (kind === "classifier") classifierCalls += 1;
      else summarizerCalls += 1;
      return ollama.chat(...(chatArgs as [never, never])) as never;
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
      missingRequired: [],
      forbiddenClaims: [],
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const window = createConversationWindow(
      fixture.messages.map((text, index) => message(index + 1, text)),
    );
    const result = await processWindow(
      window,
      {
        classifier: createClassifier({
          ollama: countedClient("classifier") as never,
        }),
        summarizer: createConversationSummarizer({
          ollama: countedClient("summarizer") as never,
        }),
      },
      controller.signal,
    );
    const summary =
      result.disposition.kind === "summarized"
        ? result.disposition.summary.text
        : undefined;
    const constraints = evaluateSummaryConstraints(fixture, summary);
    const extractionFixture = findExtractionFixture(fixture.id);

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
      ...constraints,
      ...(extractionFixture
        ? { extractionMetrics: evaluateExtraction(extractionFixture, summary) }
        : {}),
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
      missingRequired: fixture.expected.summary?.mustInclude ?? [],
      forbiddenClaims: [],
      error:
        error instanceof Error
          ? `${error.name}: ${error.message}`
          : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function message(id: number, text: string): ChatMessage {
  return Object.freeze({
    id: asMessageId(id),
    chatId: asChatId("golden-live"),
    author: Object.freeze({
      id: asAuthorId(String((id % 3) + 1)),
      label: `Participant ${(id % 3) + 1}`,
    }),
    time: asTimestampMs(1_700_000_000_000 + id * 1_000),
    parentId: null,
    text,
  });
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
    fixtureId: read("--fixture"),
    json: argv.includes("--json"),
  };
}

function selectFixtures(args: ReturnType<typeof parseArgs>): E2EFixture[] {
  const extraction = extractionFixtures.flatMap((fixture) =>
    EXTRACTION_PLACEMENTS.map((placement) =>
      expandExtractionFixture(fixture, placement),
    ),
  );
  const available =
    args.suite === "extraction"
      ? extraction
      : [...goldenFixtures, ...extraction];
  const byId = new Map(available.map((value) => [value.id, value]));
  const ids = args.fixtureId
    ? [args.fixtureId]
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
  const metrics = result.extractionMetrics;
  return (
    metrics === undefined ||
    (metrics.requiredFactRecall === 1 &&
      metrics.unsupportedFactRate === 0 &&
      metrics.supersededFactLeakRate === 0 &&
      metrics.relationPreservation === 1 &&
      metrics.entityBindingAccuracy === 1 &&
      metrics.epistemicStateAccuracy === 1)
  );
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
    const fixture = goldenFixtures.find(({ id }) => id === report.fixtureId);
    if (!fixture || report.scope === "system") return [];
    return report.runs.map((result) => assessAction(fixture, result.action));
  });
  const errors = runs.filter((result) => result.error !== undefined).length;
  const correct = runs.filter(
    (result) => result.action === result.expectedAction && !result.error,
  ).length;
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
          summarizerCalls === (action === "SUMMARIZE" ? 1 : 0),
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
      correct: acceptedSemantic.flatMap((report) => {
        const fixture = findFixture(report.fixtureId)!;
        return report.runs.filter(
          (result) => !result.error && isAcceptedAction(fixture, result.action),
        );
      }).length,
      accuracy:
        acceptedSemanticRuns.length === 0
          ? 0
          : acceptedSemantic.flatMap((report) => {
              const fixture = findFixture(report.fixtureId)!;
              return report.runs.filter(
                (result) =>
                  !result.error && isAcceptedAction(fixture, result.action),
              );
            }).length / acceptedSemanticRuns.length,
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
    excludedFromSemanticHeadline: {
      systemFixtures: reports.filter(({ scope }) => scope === "system").length,
      underReviewFixtures: reports.filter(
        ({ scope, status }) =>
          scope === "semantic" && status === "under_review",
      ).length,
    },
    weightedErrors: {
      totalCost: actionAssessments.reduce(
        (sum, assessment) => sum + assessment.cost,
        0,
      ),
      critical: actionAssessments.filter(
        ({ severity }) => severity === "critical",
      ).length,
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
    irreversibleLosses: reports.reduce(
      (sum, report) =>
        sum + report.runs.length * report.metrics.irreversibleLossRate,
      0,
    ),
    constraintViolations: runs.reduce(
      (sum, result) =>
        sum + result.missingRequired.length + result.forbiddenClaims.length,
      0,
    ),
  };
}

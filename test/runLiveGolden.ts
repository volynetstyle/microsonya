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
  evaluateRuns,
  type E2EResult,
  type EvaluationMetrics,
} from "./goldenEvaluation.js";

loadEnv({ quiet: true });

interface LiveResult extends E2EResult {
  readonly fixtureId: string;
  readonly expectedAction: E2EFixture["expected"]["action"];
  readonly durationMs: number;
  readonly modelCalls: number;
  readonly missingRequired: readonly string[];
  readonly forbiddenClaims: readonly string[];
  readonly error?: string;
}

interface FixtureReport {
  readonly fixtureId: string;
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
        : result.action === result.expectedAction
          ? "PASS"
          : "FAIL";
      process.stderr.write(
        `${marker} ${fixture.id} ${index + 1}/${args.runs}: ${result.action} (${Math.round(result.durationMs)}ms, ${result.modelCalls} calls)\n`,
      );
    }
  }
  reports.push({
    fixtureId: fixture.id,
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
    ({ metrics }) =>
      metrics.accuracy < args.minimumAccuracy ||
      metrics.irreversibleLossRate > 0 ||
      metrics.checkpointCorrectness < 1,
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
  const countedClient = {
    chat: async (...chatArgs: Parameters<OllamaClient["chat"]>) => {
      modelCalls += 1;
      return ollama.chat(...(chatArgs as [never, never])) as never;
    },
  };

  if (fixture.messages.length === 0) {
    return {
      fixtureId: fixture.id,
      expectedAction: fixture.expected.action,
      action: "EMPTY",
      checkpointAdvanced: false,
      durationMs: performance.now() - startedAt,
      modelCalls,
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
        classifier: createClassifier({ ollama: countedClient as never }),
        summarizer: createConversationSummarizer({
          ollama: countedClient as never,
        }),
      },
      controller.signal,
    );
    const summary =
      result.disposition.kind === "summarized"
        ? result.disposition.summary.text
        : undefined;
    const constraints = evaluateSummaryConstraints(fixture, summary);

    return {
      fixtureId: fixture.id,
      expectedAction: fixture.expected.action,
      action: result.decision.action,
      summary,
      checkpointAdvanced: shouldAdvanceCheckpoint(result.decision.action),
      durationMs: performance.now() - startedAt,
      modelCalls,
      ...constraints,
    };
  } catch (error) {
    return {
      fixtureId: fixture.id,
      expectedAction: fixture.expected.action,
      action: "EMPTY",
      checkpointAdvanced: false,
      durationMs: performance.now() - startedAt,
      modelCalls,
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
  const required = fixture.expected.summary?.mustInclude ?? [];
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
  if (!["smoke", "adversarial", "stability", "all"].includes(suite)) {
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
    suite: suite as "smoke" | "adversarial" | "stability" | "all",
    runs,
    timeoutMs,
    minimumAccuracy,
    fixtureId: read("--fixture"),
    json: argv.includes("--json"),
  };
}

function selectFixtures(args: ReturnType<typeof parseArgs>): E2EFixture[] {
  const byId = new Map(goldenFixtures.map((value) => [value.id, value]));
  const ids = args.fixtureId
    ? [args.fixtureId]
    : args.suite === "smoke"
      ? [...smokeE2E]
      : args.suite === "adversarial"
        ? [...adversarialE2E]
        : args.suite === "stability"
          ? [
              "live-casual-high-information-minecraft",
              "durable-70k-pc-story",
              "banter-70k-pc",
            ]
          : goldenFixtures.map(({ id }) => id);
  return ids.map((id) => {
    const value = byId.get(id);
    if (!value) throw new TypeError(`Unknown fixture: ${id}`);
    return value;
  });
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
  const errors = runs.filter((result) => result.error !== undefined).length;
  const correct = runs.filter(
    (result) => result.action === result.expectedAction && !result.error,
  ).length;
  return {
    fixtures: reports.length,
    runs: runs.length,
    modelCalls: runs.reduce((sum, result) => sum + result.modelCalls, 0),
    errors,
    accuracy: runs.length === 0 ? 0 : correct / runs.length,
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

import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { z } from "zod";
import { runOllama } from "./ollama.js";
import { serialize } from "./serializers/index.js";
import { goldSchema, messageSchema, type Gold } from "./types.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
loadEnv({ path: path.resolve(packageRoot, "../../.env") });
const variant = z.enum(["v5", "v6"]).parse(process.argv[2] ?? "v5");

// Frozen prompt variants keep stored eval results reproducible after production
// prompts evolve.
const PIPE_V3_LANGUAGE_GUIDE = [
  "Граматика рядка: #ID|AUTHOR_JSON|TIME_JSON|^PARENT|KIND_JSON|TEXT_JSON_OR_NULL",
  "^0 означає відсутність явного reply; ^N означає пряму відповідь на повідомлення #N.",
  "Рядки розташовані хронологічно.",
  "Reply-зв'язки допомагають визначати, до якої гілки розмови належить повідомлення.",
  "Посилайся на ID повідомлень у полі evidence.",
].join("\n");

function buildSummaryPrompt(
  serializedMessages: string,
  representation: string,
  languageGuide?: string,
): string {
  const sections = [
    "Стисло підсумуй Telegram-розмову за наданими повідомленнями.",
    "Виділи основні теми та важливі твердження в межах кожної теми.",
    "Враховуй авторів, хронологію та явні reply-зв'язки.",
    "Не додавай інформацію, якої немає у вхідних повідомленнях.",
    "Не перетворюй думки, припущення, жарти або прогнози учасників на встановлені факти.",
    "Зберігай важливі розбіжності між учасниками.",
    "Об'єднуй повторення та ігноруй повідомлення без суттєвого змісту.",
    "Для кожної теми наведи ID повідомлень, які безпосередньо підтверджують підсумок.",
    "Поверни тільки JSON точно такої форми:",
    JSON.stringify(
      {
        title: "Коротка назва розмови",
        summary: "Короткий загальний підсумок основного змісту розмови.",
        topics: [
          {
            topic: "Коротка назва теми",
            summary: "Що важливого було сказано про цю тему.",
            participants: ["P1", "P2"],
            evidence: [17, 21, 24],
          },
        ],
      },
      null,
      2,
    ),
    `Формат вхідних даних: ${representation}`,
  ];
  if (languageGuide) {
    sections.push("Опис формату вхідних даних:", languageGuide);
  }
  sections.push("Повідомлення:", serializedMessages);
  return sections.join("\n\n");
}

function buildClaimsPrompt(
  serializedMessages: string,
  representation: string,
  languageGuide?: string,
): string {
  const sections = [
    "Виділи з Telegram-розмови атомарні змістовні твердження, які можуть бути використані для побудови підсумку.",
    "Кожен claim повинен містити рівно одну самостійну тезу. Якщо повідомлення або фрагмент містить кілька незалежних тез, створи кілька claims.",
    "Не об'єднуй різні твердження в один великий опис теми. Runtime сам виконає ranking, dedupe, grouping і selection.",
    "Зберігай авторство тверджень. Думку, припущення, прогноз або оцінку учасника не подавай як встановлений факт.",
    "Зберігай суттєві розбіжності між учасниками як окремі claims. Не зливай протилежні позиції в компромісне формулювання.",
    "Не трактуй жарти, сарказм, іронію, гіперболу, аналогії або абсурдні приклади буквально. Не створюй із них реальні плани, рішення чи факти.",
    "Пропускай привітання, короткі реакції, повторення, побутову балаканину та інший контент, який не допомагає зрозуміти основний зміст розмови.",
    "Evidence повинно містити мінімальний набір ID повідомлень, які безпосередньо підтверджують claim. Не додавай повідомлення лише тому, що вони належать до тієї ж теми або знаходяться поруч.",
    "Якщо одного повідомлення достатньо для підтвердження claim, використовуй лише його. Додавай кілька evidence ID тільки коли claim справді залежить від кількох повідомлень.",
    "Враховуй явні reply-зв'язки для розуміння того, до якого повідомлення належить відповідь.",
    "Не намагайся самостійно створити фінальне summary. Завдання полягає лише у виділенні candidate claims.",
    "Поверни тільки JSON точно такої форми:",
    JSON.stringify(
      {
        title: "Коротка назва розмови",
        claims: [
          {
            topic: "Коротка назва теми",
            text: "Одне атомарне змістовне твердження",
            evidence: [17],
          },
        ],
      },
      null,
      2,
    ),
    `Формат вхідних даних: ${representation}`,
  ];
  if (languageGuide) {
    sections.push("Опис формату вхідних даних:", languageGuide);
  }
  sections.push("Повідомлення:", serializedMessages);
  return sections.join("\n\n");
}

const cases = [
  "discourse-state-lifecycle",
  "hypothetical",
  "interleaved",
  "interleaving-relation",
  "late-reply-resume",
  "mutation-question-assertion",
  "mutation-question-base",
  "question-vs-assertion",
  "real-ai-development",
  "real-ai-tools-interleaved",
  "real-fop-calculator",
  "real-job-search-abroad",
  "sarcasm",
] as const;

const contentSummarySchema = z
  .object({
    title: z.string().min(1),
    summary: z.string().min(1),
    topics: z.array(
      z
        .object({
          topic: z.string().min(1),
          summary: z.string().min(1),
          participants: z.array(z.string().min(1)),
          evidence: z.array(z.number().int().positive()),
        })
        .strict(),
    ),
  })
  .strict();

const claimsSummarySchema = z
  .object({
    title: z.string().min(1),
    claims: z.array(
      z
        .object({
          topic: z.string().min(1),
          text: z.string().min(1),
          evidence: z.array(z.number().int().positive()),
        })
        .strict(),
    ),
  })
  .strict();

const legacySummarySchema = z.object({
  title: z.string(),
  topics: z.array(
    z.object({
      claims: z.array(
        z.object({ text: z.string(), evidence: z.array(z.number().int()) }),
      ),
    }),
  ),
  decisions: z.array(
    z.object({ text: z.string(), evidence: z.array(z.number().int()) }),
  ),
  openQuestions: z.array(
    z.object({ text: z.string(), evidence: z.array(z.number().int()) }),
  ),
});

type Candidate = { text: string; evidence: number[] };
type Metrics = ReturnType<typeof scoreSelection>;
type Result = {
  case: string;
  status: "ok" | "parse_failure" | "request_failure";
  raw: string;
  thinking: string;
  parsed:
    | z.infer<typeof contentSummarySchema>
    | z.infer<typeof claimsSummarySchema>
    | null;
  error?: string;
  usage: { durationMs: number; finalTextTokenCount?: number };
  metrics: Metrics | null;
};

const outputRoot = path.join(
  packageRoot,
  "results",
  variant === "v5" ? "content-v5-120b" : "claims-v6-120b",
);
await mkdir(outputRoot, { recursive: true });

const rows: Array<{
  case: string;
  baseline: Metrics | null;
  v5: Metrics | null;
  current: Metrics | null;
  baselineLatencyMs: number | null;
  v5LatencyMs: number | null;
  currentLatencyMs: number | null;
  currentStatus: Result["status"];
}> = [];

for (const caseName of cases) {
  const caseRoot = path.join(packageRoot, "cases", caseName);
  const messages = z
    .array(messageSchema)
    .parse(await readJson(path.join(caseRoot, "messages.json")));
  const gold = goldSchema.parse(
    await readJson(path.join(caseRoot, "gold.json")),
  );
  const promptBuilder =
    variant === "v5" ? buildSummaryPrompt : buildClaimsPrompt;
  const prompt = promptBuilder(
    serialize("pipe-v3", messages),
    "pipe-v3",
    PIPE_V3_LANGUAGE_GUIDE,
  );
  const outputPath = path.join(outputRoot, `${caseName}.json`);

  process.stdout.write(`Running ${caseName} ... `);
  const executed = await execute(
    prompt,
    gold,
    new Set(messages.map(({ id }) => id)),
    variant,
  );
  const result = { ...executed, case: caseName };
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(
    result.status === "ok"
      ? `${(result.usage.durationMs / 1000).toFixed(1)}s`
      : result.status,
  );

  const baselinePath = path.join(
    packageRoot,
    "results",
    "model-screening-v1",
    caseName,
    "gpt-oss-120b",
    "direct",
    "pipe-v3",
    "low",
    "seed-1.json",
  );
  const baselineRun = (await readJson(baselinePath)) as {
    status: string;
    parsed?: unknown;
    usage?: { durationMs?: number };
  };
  const baselineParsed = legacySummarySchema.safeParse(baselineRun.parsed);
  const baselineCandidates = baselineParsed.success
    ? [
        ...baselineParsed.data.topics.flatMap(({ claims }) => claims),
        ...baselineParsed.data.decisions,
        ...baselineParsed.data.openQuestions,
      ]
    : null;
  const v5Run = await readOptionalJson(
    path.join(packageRoot, "results", "content-v5-120b", `${caseName}.json`),
  );
  const v5Parsed = contentSummarySchema.safeParse(
    isRecord(v5Run) ? v5Run.parsed : null,
  );
  const v5Candidates = v5Parsed.success
    ? v5Parsed.data.topics.map((topic) => ({
        text: topic.summary,
        evidence: topic.evidence,
      }))
    : null;
  const validIds = new Set(messages.map(({ id }) => id));

  rows.push({
    case: caseName,
    baseline:
      baselineCandidates === null
        ? null
        : scoreSelection(baselineCandidates, gold, validIds),
    v5:
      v5Candidates === null
        ? null
        : scoreSelection(v5Candidates, gold, validIds),
    current: result.metrics,
    baselineLatencyMs: baselineRun.usage?.durationMs ?? null,
    v5LatencyMs: readDurationMs(v5Run),
    currentLatencyMs: result.usage.durationMs,
    currentStatus: result.status,
  });
}

const report = {
  experiment: variant === "v5" ? "content-v5-120b" : "claims-v6-120b",
  model: "gpt-oss:120b-cloud",
  reasoning: "low",
  seed: 1,
  cases: rows.length,
  baseline: aggregate(rows.map(({ baseline }) => baseline)),
  v5: aggregate(rows.map(({ v5 }) => v5)),
  current: aggregate(rows.map(({ current }) => current)),
  latency: {
    baselineMeanMs: mean(
      rows.map(({ baselineLatencyMs }) => baselineLatencyMs),
    ),
    v5MeanMs: mean(rows.map(({ v5LatencyMs }) => v5LatencyMs)),
    currentMeanMs: mean(rows.map(({ currentLatencyMs }) => currentLatencyMs)),
  },
  failures: rows.filter(({ currentStatus }) => currentStatus !== "ok").length,
  rows,
};

await writeFile(
  path.join(outputRoot, "comparison.json"),
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8",
);
console.log(JSON.stringify(report, null, 2));

async function execute(
  prompt: string,
  gold: Gold,
  validIds: Set<number>,
  promptVariant: "v5" | "v6",
): Promise<Result> {
  try {
    const response = await runOllama({
      model: "gpt-oss:120b-cloud",
      prompt,
      reasoning: "low",
      seed: 1,
      baseUrl: "http://localhost:11434",
    });
    let json: unknown;
    try {
      json = JSON.parse(response.content.trim());
    } catch (error) {
      return {
        case: "",
        status: "parse_failure",
        raw: response.content,
        thinking: response.thinking,
        parsed: null,
        error: error instanceof Error ? error.message : String(error),
        usage: response.usage,
        metrics: null,
      };
    }
    const parsed =
      promptVariant === "v5"
        ? contentSummarySchema.safeParse(json)
        : claimsSummarySchema.safeParse(json);
    if (!parsed.success) {
      return {
        case: "",
        status: "parse_failure",
        raw: response.content,
        thinking: response.thinking,
        parsed: null,
        error: parsed.error.message,
        usage: response.usage,
        metrics: null,
      };
    }
    const candidates =
      "topics" in parsed.data
        ? parsed.data.topics.map((topic) => ({
            text: topic.summary,
            evidence: topic.evidence,
          }))
        : parsed.data.claims.map((claim) => ({
            text: claim.text,
            evidence: claim.evidence,
          }));
    return {
      case: "",
      status: "ok",
      raw: response.content,
      thinking: response.thinking,
      parsed: parsed.data,
      usage: response.usage,
      metrics: scoreSelection(candidates, gold, validIds),
    };
  } catch (error) {
    return {
      case: "",
      status: "request_failure",
      raw: "",
      thinking: "",
      parsed: null,
      error: error instanceof Error ? error.message : String(error),
      usage: { durationMs: 0 },
      metrics: null,
    };
  }
}

function scoreSelection(
  candidates: Candidate[],
  gold: Gold,
  validIds: Set<number>,
) {
  const selected = new Set(candidates.flatMap(({ evidence }) => evidence));
  const goldItems = [...gold.claims, ...gold.decisions, ...gold.openQuestions];
  const supportedIds = new Set(goldItems.flatMap(({ evidence }) => evidence));
  const totalWeight = goldItems.reduce((sum, item) => sum + item.weight, 0);
  const coveredWeight = goldItems
    .filter(({ evidence }) => evidence.some((id) => selected.has(id)))
    .reduce((sum, item) => sum + item.weight, 0);
  const knownSelected = [...selected].filter((id) => validIds.has(id));
  const normalizedText = candidates
    .map(({ text }) => text)
    .join("\n")
    .normalize("NFKC")
    .toLocaleLowerCase("uk-UA");
  const forbiddenHits = gold.forbidden.filter((item) =>
    (item.patterns ?? [item.text]).some((pattern) =>
      normalizedText.includes(
        pattern.normalize("NFKC").toLocaleLowerCase("uk-UA"),
      ),
    ),
  ).length;
  const atomicityViolations = candidates.filter((candidate) => {
    const evidence = new Set(candidate.evidence);
    return (
      goldItems.filter((item) => item.evidence.some((id) => evidence.has(id)))
        .length > 1
    );
  }).length;
  const evidenceAssignments = candidates.reduce(
    (sum, candidate) => sum + candidate.evidence.length,
    0,
  );

  return {
    contentRecall: totalWeight === 0 ? null : coveredWeight / totalWeight,
    claimRecall: recall(gold.claims, selected),
    decisionRecall: recall(gold.decisions, selected),
    openQuestionRecall: recall(gold.openQuestions, selected),
    evidenceSelectionPrecision:
      knownSelected.length === 0
        ? null
        : knownSelected.filter((id) => supportedIds.has(id)).length /
          knownSelected.length,
    noiseSelectionRate:
      knownSelected.length === 0
        ? 0
        : knownSelected.filter((id) => gold.noiseEvidence.includes(id)).length /
          knownSelected.length,
    forbiddenRate: forbiddenHits / Math.max(gold.forbidden.length, 1),
    atomicityViolationRate:
      candidates.length === 0 ? 0 : atomicityViolations / candidates.length,
    evidenceIdsPerUnit:
      candidates.length === 0 ? 0 : evidenceAssignments / candidates.length,
    unitCount: candidates.length,
    selectedEvidenceCount: selected.size,
    unknownEvidenceCount: [...selected].filter((id) => !validIds.has(id))
      .length,
  };
}

function recall(
  items: Array<{ evidence: number[]; weight: number }>,
  selected: Set<number>,
): number | null {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  return total === 0
    ? null
    : items
        .filter(({ evidence }) => evidence.some((id) => selected.has(id)))
        .reduce((sum, item) => sum + item.weight, 0) / total;
}

function aggregate(metrics: Array<Metrics | null>) {
  const valid = metrics.filter((item): item is Metrics => item !== null);
  return {
    validRuns: valid.length,
    contentRecall: mean(valid.map(({ contentRecall }) => contentRecall)),
    claimRecall: mean(valid.map(({ claimRecall }) => claimRecall)),
    decisionRecall: mean(valid.map(({ decisionRecall }) => decisionRecall)),
    openQuestionRecall: mean(
      valid.map(({ openQuestionRecall }) => openQuestionRecall),
    ),
    evidenceSelectionPrecision: mean(
      valid.map(({ evidenceSelectionPrecision }) => evidenceSelectionPrecision),
    ),
    noiseSelectionRate: mean(
      valid.map(({ noiseSelectionRate }) => noiseSelectionRate),
    ),
    forbiddenRate: mean(valid.map(({ forbiddenRate }) => forbiddenRate)),
    atomicityViolationRate: mean(
      valid.map(({ atomicityViolationRate }) => atomicityViolationRate),
    ),
    evidenceIdsPerUnit: mean(
      valid.map(({ evidenceIdsPerUnit }) => evidenceIdsPerUnit),
    ),
    unitCount: mean(valid.map(({ unitCount }) => unitCount)),
    selectedEvidenceCount: mean(
      valid.map(({ selectedEvidenceCount }) => selectedEvidenceCount),
    ),
  };
}

function mean(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length === 0
    ? null
    : present.reduce((sum, value) => sum + value, 0) / present.length;
}

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, "utf8"));
}

async function readOptionalJson(file: string): Promise<unknown> {
  try {
    return await readJson(file);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readDurationMs(value: unknown): number | null {
  if (!isRecord(value) || !isRecord(value.usage)) return null;
  return typeof value.usage.durationMs === "number"
    ? value.usage.durationMs
    : null;
}

import { performance } from "node:perf_hooks";
import { createDataEncryption } from "../packages/db/src/index.js";
import { OllamaClient } from "../packages/model/src/index.js";
import {
  asAuthorId,
  asChatId,
  asMessageId,
  asTimestampMs,
  type ChatMessage,
  type SummaryRunAttempt,
} from "../packages/shared/src/index.js";
import {
  createSummarizer,
  SummarizationTelemetryService,
} from "../packages/summarize/src/index.js";
import { createMessageHandler } from "../apps/telegram/bot/src/telegramHandlers.js";
// Telegraf is intentionally owned by the bot workspace, not the root package.
// @ts-expect-error TypeScript does not follow declarations through this package-local path.
import { Telegraf } from "../apps/telegram/bot/node_modules/telegraf/lib/index.js";

type Scenario = "skip" | "summarize";

const options = parseOptions(process.argv.slice(2));

console.log(
  `Microsonya local /summary CPU proxy: ${options.messages} messages, ` +
    `${options.warmup} warmups, ${options.iterations} measured runs`,
);
console.log(
  "Network I/O is mocked; prompt/parsing, telemetry/evidence and at-rest crypto remain enabled.\n",
);

for (const scenario of ["skip", "summarize"] as const) {
  const result = await benchmarkScenario(scenario, options);
  printResult(scenario, result);
}

async function benchmarkScenario(
  scenario: Scenario,
  config: typeof options,
): Promise<{ cold: number; samples: number[] }> {
  const runner = createRunner(scenario, config.messages);
  const cold = await measure(() => runner.run());

  for (let index = 0; index < config.warmup; index += 1) {
    await runner.run();
  }

  const samples: number[] = [];
  for (let index = 0; index < config.iterations; index += 1) {
    samples.push(await measure(() => runner.run()));
  }

  runner.assertCallCounts(config.warmup + config.iterations + 1);
  return { cold, samples };
}

function createRunner(scenario: Scenario, messageCount: number) {
  let sequence = 0;
  let modelCalls = 0;
  let telegramCalls = 0;
  const encryption = createDataEncryption(Buffer.alloc(32, 0x2a));
  const classifierOutput = JSON.stringify(
    scenario === "skip"
      ? {
          durable: false,
          essentialReferentsResolved: true,
          visiblyIncomplete: false,
          alreadyCompact: false,
          primarilyReaction: true,
          primarilyBanter: false,
          requiresSynthesis: false,
        }
      : {
          durable: true,
          essentialReferentsResolved: true,
          visiblyIncomplete: false,
          alreadyCompact: false,
          primarilyReaction: false,
          primarilyBanter: false,
          requiresSynthesis: true,
        },
  );
  const summaryOutput = JSON.stringify({
    summary:
      "Deploy proceeds in two phases: migrate Wednesday, then enable checkout Thursday after Stripe access is verified; rollback keeps checkout behind the feature flag.",
  });

  const ollama = new OllamaClient({
    baseUrl: "https://model.invalid/api",
    fetch: async (_input, init) => {
      modelCalls += 1;
      const request = JSON.parse(String(init?.body)) as {
        messages: Array<{ content: string }>;
      };
      const isClassifier = request.messages[0]?.content.includes(
        "CLASSIFICATION_POLICY",
      );
      const content = isClassifier ? classifierOutput : summaryOutput;
      return new Response(
        JSON.stringify({
          model: "gpt-oss:120b-cloud",
          created_at: "2026-08-27T00:00:00Z",
          message: { role: "assistant", content },
          done: true,
          done_reason: "stop",
          prompt_eval_count: 512,
          eval_count: 32,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  const summaries = {
    findLastRun: async () => undefined,
    saveRun: async () => undefined,
    saveAttempt: async (attempt: SummaryRunAttempt) => {
      // Mirror the privacy transforms at the Postgres boundary, but omit SQL.
      encryption.lookup(attempt.chatId, "telegram-chat-id");
      encryption.lookup(attempt.inputHash, "summary-input-hash");
      if (attempt.classifierPromptHash) {
        encryption.lookup(
          attempt.classifierPromptHash,
          "classifier-prompt-hash",
        );
      }
      if (attempt.summaryPromptHash) {
        encryption.lookup(attempt.summaryPromptHash, "summary-prompt-hash");
      }
      if (attempt.summaryText) encryption.encrypt(attempt.summaryText);
      const authorKeys = new Map<string, string>();
      for (const message of attempt.messages) {
        if (message.chatId !== attempt.chatId) {
          encryption.lookup(message.chatId, "telegram-chat-id");
        }
        if (!authorKeys.has(message.authorId)) {
          authorKeys.set(
            message.authorId,
            encryption.lookup(message.authorId, "telegram-author-id"),
          );
        }
        encryption.encrypt(message.authorName);
        encryption.encrypt(message.text);
      }
      for (const invocation of attempt.modelInvocations) {
        encryption.lookup(
          invocation.promptHash,
          `${invocation.stage}-prompt-hash`,
        );
        if (invocation.outputText) encryption.encrypt(invocation.outputText);
      }
    },
  };
  const summarizer = createSummarizer({
    messages: {
      listByChat: async (chatId) => conversation(chatId, messageCount),
    },
    summaries,
    ollama,
    telemetry: new SummarizationTelemetryService(() => undefined),
  });
  const bot = new Telegraf("benchmark-token");
  bot.botInfo = {
    id: 1,
    is_bot: true,
    first_name: "Microsonya",
    username: "microsonya_benchmark_bot",
    can_join_groups: true,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
  };
  Object.assign(bot.context, {
    telegram: {
      callApi: async () => {
        telegramCalls += 1;
        return true;
      },
    },
  });
  bot.on(
    "message",
    createMessageHandler({
      messages: { save: async () => undefined },
      summarizer,
    }),
  );

  return {
    async run(): Promise<void> {
      sequence += 1;
      const chatId = -(1_000_000 + sequence);
      const commandMessageId = 10_000 + sequence;
      await bot.handleUpdate({
        update_id: sequence,
        message: {
          message_id: commandMessageId,
          date: 1_788_000_000,
          chat: {
            id: chatId,
            type: "private",
            first_name: "Benchmark",
          },
          from: {
            id: Math.abs(chatId),
            is_bot: false,
            first_name: "Benchmark",
          },
          text: "/summary",
          entities: [{ type: "bot_command", offset: 0, length: 8 }],
        },
      });
    },
    assertCallCounts(runs: number): void {
      const expectedModelCalls = runs * (scenario === "summarize" ? 2 : 1);
      if (modelCalls !== expectedModelCalls || telegramCalls !== runs) {
        throw new Error(
          `Incomplete E2E path: expected ${expectedModelCalls}/${runs} ` +
            `model/Telegram calls, got ${modelCalls}/${telegramCalls}.`,
        );
      }
    },
  };
}

function conversation(
  chatId: ReturnType<typeof asChatId>,
  count: number,
): readonly ChatMessage[] {
  const topics = [
    "Stripe production access is pending verification.",
    "Migration 42 runs Wednesday at 18:00 and must finish before deploy.",
    "Checkout remains behind the payments-v2 feature flag.",
    "If error rate exceeds 1.8%, roll back checkout but keep the migration.",
    "The old 17:00 deployment time is superseded by the final 18:00 slot.",
    "Heap growth is still a hypothesis; the confirmed blocker is Stripe access.",
  ];
  return Array.from({ length: count }, (_, index) => ({
    id: asMessageId(index + 1),
    chatId,
    author: {
      id: asAuthorId(`author-${index % 4}`),
      label: ["Olia", "Taras", "Marta", "Denys"][index % 4]!,
    },
    time: asTimestampMs(1_787_999_000_000 + index * 1_000),
    parentId: index > 0 && index % 7 === 0 ? asMessageId(index) : null,
    text: topics[index % topics.length]!,
  }));
}

async function measure(operation: () => Promise<void>): Promise<number> {
  const startedAt = performance.now();
  await operation();
  return performance.now() - startedAt;
}

function printResult(
  scenario: Scenario,
  result: { cold: number; samples: number[] },
): void {
  const sorted = [...result.samples].sort((left, right) => left - right);
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const p50 = percentile(sorted, 0.5);
  const p95 = percentile(sorted, 0.95);
  const p99 = percentile(sorted, 0.99);
  console.log(
    scenario === "skip" ? "SKIP (1 model call)" : "SUMMARIZE (2 model calls)",
  );
  console.log(`  cold  ${format(result.cold)} ms`);
  console.log(`  mean  ${format(mean)} ms`);
  console.log(`  p50   ${format(p50)} ms`);
  console.log(`  p95   ${format(p95)} ms`);
  console.log(`  p99   ${format(p99)} ms`);
  console.log(`  max   ${format(sorted.at(-1)!)} ms`);
  console.log(`  gate  ${workersGate(p95)} (by warm p95)\n`);
}

function percentile(sorted: readonly number[], quantile: number): number {
  return sorted[Math.ceil(sorted.length * quantile) - 1]!;
}

function workersGate(milliseconds: number): string {
  if (milliseconds <= 5) return "Workers looks excellent";
  if (milliseconds <= 10) return "acceptable; monitor CPU";
  if (milliseconds <= 20) return "free Workers is uncomfortable";
  return "do not force the architecture";
}

function format(value: number): string {
  return value.toFixed(3).padStart(7);
}

function parseOptions(args: readonly string[]) {
  const readInteger = (name: string, fallback: number): number => {
    const index = args.indexOf(name);
    if (index === -1) return fallback;
    const value = Number(args[index + 1]);
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new TypeError(`${name} must be a positive integer.`);
    }
    return value;
  };
  return Object.freeze({
    iterations: readInteger("--iterations", 1_000),
    warmup: readInteger("--warmup", 100),
    messages: readInteger("--messages", 24),
  });
}

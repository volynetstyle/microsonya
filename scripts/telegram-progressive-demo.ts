import { performance } from "node:perf_hooks";
import { setTimeout as sleep } from "node:timers/promises";

import {
  EditableMessageTransport,
  GROUP_PROGRESSIVE_POLICY,
  PrivateDraftTransport,
  type ProgressiveTransport,
  type TelegramApi,
} from "../packages/telegram/src/index.js";

const TEXT = `Підсумок розмови за останні повідомлення.
Андрій запропонував винести керування прогресивним виведенням повідомлень в окремий транспортний шар. Основна ідея полягає в тому, щоб розділити логіку генерації контенту та його доставки до Telegram, а всі проміжні оновлення повідомлення обробляти централізовано.
Замість того щоб відправляти кожну нову версію повідомлення окремим запитом, транспортний шар має об'єднувати послідовні проміжні версії та доставляти лише актуальний стан. Це дозволить уникнути ситуації, коли під час генерації тексту накопичується десятки або навіть сотні одночасних запитів до Telegram API.
При цьому важливо зберегти перевагу прогресивного виведення — користувач повинен отримати перший змістовний результат якомога швидше, не чекаючи завершення всієї генерації. Після цього повідомлення можна оновлювати з певною частотою або за умови, що накопичилося достатньо нової інформації.
Окремо потрібно передбачити обробку фінальної версії: незалежно від того, скільки проміжних оновлень було об'єднано або пропущено, фінальний результат повинен бути гарантовано доставлений користувачу. Таким чином, проміжні оновлення можуть бути оптимізовані заради продуктивності, але фінальний стан повідомлення не повинен втрачатися.
Такий підхід дозволить зменшити навантаження на Telegram API, уникнути зайвих запитів і потенційних rate limit, а також зробити механізм прогресивного виведення більш передбачуваним. Водночас основна логіка генерації залишиться незалежною від конкретного способу доставки повідомлень, що спростить подальше розширення та тестування системи.`;

const PROFILES = [
  "slow",
  "normal",
  "burst",
  "fast",
  "stall",
  "backlog",
] as const;

type Profile = (typeof PROFILES)[number];

const DEFAULT_PROFILE: Profile = "normal";
const DEFAULT_SEED = 0x5eedc0de;

interface CliOptions {
  readonly profile: Profile;
  readonly chatId: string;
  readonly threadId?: number;
  readonly commandMessageId?: number;
  readonly draftId?: number;
  readonly seed: number;
  readonly intervalMs?: number;
}

interface StreamEvent {
  readonly chunk: string;
  readonly delayMs: number;
}

interface ApiCallMetric {
  readonly method: string;
  readonly operation: string;
  readonly chars: number | undefined;
  readonly startedAt: number;
  readonly durationMs: number;
  readonly ok: boolean;
  readonly sourceCharsAtStart: number;
  readonly backlogChars: number;
}

interface TelegramPayload {
  readonly ok?: boolean;
  readonly error_code?: number;
  readonly description?: string;
  readonly parameters?: {
    readonly retry_after?: number;
  };
}

type Trace = (event: string, chars?: number) => void;

function parseInteger(value: string, flag: string): number {
  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${flag} requires a safe integer, got: ${value}`);
  }

  return parsed;
}

function parseProfile(value: string): Profile {
  if ((PROFILES as readonly string[]).includes(value)) {
    return value as Profile;
  }

  throw new Error(
    `Unknown profile "${value}". Expected: ${PROFILES.join(", ")}`,
  );
}

function requireValue(
  argv: readonly string[],
  index: number,
  flag: string,
): string {
  const value = argv[index + 1];

  if (value === undefined) {
    throw new Error(`${flag} requires a value.`);
  }

  return value;
}

function parseArgs(argv: readonly string[]): CliOptions {
  let index = 0;

  let profile = DEFAULT_PROFILE;
  let chatId = process.env.TELEGRAM_DEMO_CHAT_ID;

  let threadId: number | undefined;
  let commandMessageId: number | undefined;
  let draftId: number | undefined;
  let seed = DEFAULT_SEED;
  let intervalMs: number | undefined;

  if (argv[0] !== undefined && !argv[0].startsWith("--")) {
    profile = parseProfile(argv[0]);
    index = 1;
  }

  while (index < argv.length) {
    const flag = argv[index]!;

    switch (flag) {
      case "--chat": {
        chatId = requireValue(argv, index, flag);
        index += 2;
        break;
      }

      case "--thread": {
        threadId = parseInteger(requireValue(argv, index, flag), flag);
        index += 2;
        break;
      }

      case "--reply": {
        commandMessageId = parseInteger(requireValue(argv, index, flag), flag);
        index += 2;
        break;
      }

      case "--draft": {
        draftId = parseInteger(requireValue(argv, index, flag), flag);
        index += 2;
        break;
      }

      case "--seed": {
        seed = parseInteger(requireValue(argv, index, flag), flag);
        index += 2;
        break;
      }

      case "--interval": {
        intervalMs = parseInteger(requireValue(argv, index, flag), flag);
        if (intervalMs <= 0) {
          throw new Error("--interval must be positive.");
        }
        index += 2;
        break;
      }

      default:
        throw new Error(`Unknown argument: ${flag}`);
    }
  }

  if (!chatId) {
    throw new Error("Pass --chat <id> or set TELEGRAM_DEMO_CHAT_ID.");
  }

  return {
    profile,
    chatId,
    seed,
    ...(intervalMs === undefined ? {} : { intervalMs }),
    ...(threadId === undefined ? {} : { threadId }),
    ...(commandMessageId === undefined ? {} : { commandMessageId }),
    ...(draftId === undefined ? {} : { draftId }),
  };
}

function createTrace(startedAt: number): Trace {
  return (event, chars) => {
    const elapsed = String(Math.round(performance.now() - startedAt)).padStart(
      5,
      " ",
    );

    console.log(
      `[${elapsed}ms] ${event}${chars === undefined ? "" : ` chars=${chars}`}`,
    );
  };
}

/**
 * Deterministic PRNG.
 *
 * This matters for visual A/B testing: the same seed produces
 * exactly the same sequence of model chunks.
 */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state += 0x6d2b79f5;

    let value = state;

    value = Math.imul(value ^ (value >>> 15), value | 1);

    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);

    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function randomBetween(random: () => number, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

function* randomSequence(
  text: string,
  random: () => number,
  minSize: number,
  maxSize: number,
  minDelayMs: number,
  maxDelayMs: number,
): Generator<StreamEvent> {
  let offset = 0;

  while (offset < text.length) {
    const size = randomBetween(random, minSize, maxSize);

    const chunk = text.slice(offset, offset + size);

    offset += chunk.length;

    yield {
      chunk,
      delayMs: randomBetween(random, minDelayMs, maxDelayMs),
    };
  }
}

function* burstSequence(text: string): Generator<StreamEvent> {
  const pattern = [
    { size: 3, delayMs: 30 },
    { size: 5, delayMs: 40 },
    { size: 120, delayMs: 10 },
    { size: 8, delayMs: 500 },
    { size: 40, delayMs: 35 },
    { size: 200, delayMs: 10 },
  ] as const;

  let offset = 0;
  let index = 0;

  while (offset < text.length) {
    const step = pattern[index % pattern.length]!;

    const chunk = text.slice(offset, offset + step.size);

    offset += chunk.length;
    index++;

    yield {
      chunk,
      delayMs: step.delayMs,
    };
  }
}

function* stallSequence(
  text: string,
  random: () => number,
): Generator<StreamEvent> {
  let offset = 0;
  let stalled = false;

  const stallAfter = Math.floor(text.length / 3);

  while (offset < text.length) {
    const size = randomBetween(random, 8, 18);

    const chunk = text.slice(offset, offset + size);

    const nextOffset = offset + chunk.length;

    const shouldStall = !stalled && nextOffset >= stallAfter;

    if (shouldStall) {
      stalled = true;
    }

    offset = nextOffset;

    yield {
      chunk,
      delayMs: shouldStall ? 3_000 : 70,
    };
  }
}

function sequence(
  profile: Profile,
  text: string,
  random: () => number,
): Generator<StreamEvent> {
  switch (profile) {
    case "slow":
      return randomSequence(text, random, 2, 8, 100, 250);

    case "normal":
      return randomSequence(text, random, 5, 20, 30, 100);

    case "fast":
      return randomSequence(text, random, 20, 100, 5, 20);

    case "backlog":
      return randomSequence(text, random, 2, 8, 0, 0);

    case "burst":
      return burstSequence(text);

    case "stall":
      return stallSequence(text, random);
  }
}

async function sleepUntil(targetTime: number): Promise<void> {
  const remaining = targetTime - performance.now();

  if (remaining > 0) {
    await sleep(remaining);
  }
}

function operationName(method: string): string {
  switch (method) {
    case "sendMessage":
      return "SEND";

    case "editMessageText":
      return "EDIT";

    case "sendMessageDraft":
      return "DRAFT";

    case "sendChatAction":
      return "ACTION";

    default:
      return method;
  }
}

function bodyChars(
  body: Readonly<Record<string, unknown>>,
): number | undefined {
  return typeof body.text === "string" ? body.text.length : undefined;
}

function parsePayload(
  raw: string,
  method: string,
  status: number,
): TelegramPayload {
  try {
    return JSON.parse(raw) as TelegramPayload;
  } catch {
    const preview = raw.length <= 200 ? raw : `${raw.slice(0, 200)}…`;

    throw new Error(
      `Telegram ${method} returned non-JSON (${status}): ${preview}`,
    );
  }
}

function telegramApi(
  token: string,
  trace: Trace,
  metrics: ApiCallMetric[],
  sourceChars: () => number,
): TelegramApi {
  return {
    async call(method, body) {
      const operation = operationName(method);

      const chars = bodyChars(body);

      const requestStartedAt = performance.now();
      const sourceCharsAtStart = sourceChars();
      const backlogChars = Math.max(0, sourceCharsAtStart - (chars ?? 0));

      trace(
        `${operation} start source=${sourceCharsAtStart} backlog=${backlogChars}`,
        chars,
      );

      try {
        const response = await fetch(
          `https://api.telegram.org/bot${token}/${method}`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify(body),
          },
        );

        const raw = await response.text();

        const payload = parsePayload(raw, method, response.status);

        if (!response.ok || payload.ok !== true) {
          const retryAfter = payload.parameters?.retry_after;

          throw new Error(
            [
              `Telegram ${method} failed`,
              `status=${response.status}`,
              payload.error_code === undefined
                ? undefined
                : `error_code=${payload.error_code}`,
              payload.description,
              retryAfter === undefined
                ? undefined
                : `retry_after=${retryAfter}s`,
            ]
              .filter(Boolean)
              .join(" "),
          );
        }

        const durationMs = performance.now() - requestStartedAt;

        metrics.push({
          method,
          operation,
          chars,
          startedAt: requestStartedAt,
          durationMs,
          ok: true,
          sourceCharsAtStart,
          backlogChars,
        });

        trace(`${operation} ok rtt=${Math.round(durationMs)}ms`, chars);

        return payload;
      } catch (error) {
        const durationMs = performance.now() - requestStartedAt;

        metrics.push({
          method,
          operation,
          chars,
          startedAt: requestStartedAt,
          durationMs,
          ok: false,
          sourceCharsAtStart,
          backlogChars,
        });

        trace(`${operation} error rtt=${Math.round(durationMs)}ms`, chars);

        throw error;
      }
    },
  };
}

function average(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);

  const index = Math.min(
    sorted.length - 1,
    Math.floor(fraction * sorted.length),
  );

  return sorted[index]!;
}

function printSummary(
  options: CliOptions,
  startedAt: number,
  finishedAt: number,
  metrics: readonly ApiCallMetric[],
  updatesReceived: number,
  sourceLags: readonly number[],
  commitLatencyMs: number,
): void {
  const successful = metrics.filter((metric) => metric.ok);

  const textWrites = successful.filter(
    ({ operation, chars }) =>
      chars !== undefined &&
      chars > 0 &&
      (operation === "SEND" || operation === "EDIT" || operation === "DRAFT"),
  );

  const edits = textWrites.filter(({ operation }) => operation === "EDIT");

  const drafts = textWrites.filter(({ operation }) => operation === "DRAFT");

  const sends = textWrites.filter(({ operation }) => operation === "SEND");

  const rtts = successful.map(({ durationMs }) => durationMs);

  const firstVisible = textWrites[0];

  const jumps: number[] = [];
  let previousChars = 0;

  for (const write of textWrites) {
    const chars = write.chars ?? 0;

    const delta = chars - previousChars;

    if (delta > 0) {
      jumps.push(delta);
    }

    /*
     * sendMessage after a draft can contain the same final
     * snapshot. max() keeps jump statistics meaningful for both
     * transports.
     */
    previousChars = Math.max(previousChars, chars);
  }

  console.log();
  console.log("=== progressive demo summary ===");
  console.log(`profile:             ${options.profile}`);
  console.log(`seed:                ${options.seed}`);
  console.log(
    `group interval:      ${options.intervalMs ?? GROUP_PROGRESSIVE_POLICY.intervalMs} ms`,
  );
  console.log(`generated chars:     ${TEXT.length}`);
  console.log(`updates received:    ${updatesReceived}`);
  console.log(
    `physical text writes:${String(textWrites.length).padStart(5, " ")}`,
  );
  console.log(`  sends:              ${sends.length}`);
  console.log(`  edits:              ${edits.length}`);
  console.log(`  drafts:             ${drafts.length}`);

  if (updatesReceived > 0) {
    const ratio = textWrites.length / updatesReceived;

    console.log(`writes/update:       ${ratio.toFixed(3)}`);
  }

  if (jumps.length > 0) {
    console.log(`avg visible jump:    ${average(jumps).toFixed(1)} chars`);
    console.log(`max visible jump:    ${Math.max(...jumps)} chars`);
  }

  if (rtts.length > 0) {
    console.log(`avg API RTT:         ${average(rtts).toFixed(1)} ms`);
    console.log(`p95 API RTT:         ${percentile(rtts, 0.95).toFixed(1)} ms`);
  }

  for (const operation of ["ACTION", "SEND", "EDIT", "DRAFT"] as const) {
    const operationMetrics = successful.filter(
      (metric) => metric.operation === operation,
    );
    if (operationMetrics.length === 0) continue;
    const durations = operationMetrics.map(({ durationMs }) => durationMs);
    console.log(`${operation} successful:      ${operationMetrics.length}`);
    console.log(
      `${operation} median RTT:      ${percentile(durations, 0.5).toFixed(1)} ms`,
    );
    console.log(
      `${operation} p95 RTT:         ${percentile(durations, 0.95).toFixed(1)} ms`,
    );
    console.log(
      `${operation} slow (>1s):      ${durations.filter((value) => value > 1_000).length}`,
    );
  }

  if (edits.length > 0) {
    const startIntervals = edits
      .slice(1)
      .map((metric, index) => metric.startedAt - edits[index]!.startedAt);
    const completionIntervals = edits
      .slice(1)
      .map(
        (metric, index) =>
          metric.startedAt +
          metric.durationMs -
          (edits[index]!.startedAt + edits[index]!.durationMs),
      );
    const backlogs = edits.map(({ backlogChars }) => backlogChars);
    console.log(
      `EDIT avg start gap:  ${average(startIntervals).toFixed(1)} ms`,
    );
    console.log(
      `EDIT avg finish gap: ${average(completionIntervals).toFixed(1)} ms`,
    );
    console.log(`EDIT avg backlog:    ${average(backlogs).toFixed(1)} chars`);
    console.log(`EDIT max backlog:    ${Math.max(...backlogs)} chars`);
  }

  if (sourceLags.length > 0) {
    console.log(`avg source lag:      ${average(sourceLags).toFixed(1)} ms`);
    console.log(
      `p95 source lag:      ${percentile(sourceLags, 0.95).toFixed(1)} ms`,
    );
  }

  if (firstVisible !== undefined) {
    console.log(
      `first visible:       ${(firstVisible.startedAt - startedAt).toFixed(1)} ms`,
    );
  }

  console.log(`commit latency:       ${commitLatencyMs.toFixed(1)} ms`);
  console.log(
    `total duration:       ${(finishedAt - startedAt).toFixed(1)} ms`,
  );
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    throw new Error("Set TELEGRAM_BOT_TOKEN before running the demo.");
  }

  const startedAt = performance.now();

  const metrics: ApiCallMetric[] = [];
  let sourceChars = 0;

  const trace = createTrace(startedAt);

  const api = telegramApi(token, trace, metrics, () => sourceChars);

  const transport: ProgressiveTransport =
    options.draftId === undefined
      ? new EditableMessageTransport(
          api,
          {
            chatId: options.chatId,
            ...(options.commandMessageId === undefined
              ? {}
              : {
                  commandMessageId: options.commandMessageId,
                }),
            ...(options.threadId === undefined
              ? {}
              : {
                  messageThreadId: options.threadId,
                }),
          },
          {
            ...GROUP_PROGRESSIVE_POLICY,
            intervalMs:
              options.intervalMs ?? GROUP_PROGRESSIVE_POLICY.intervalMs,
          },
        )
      : new PrivateDraftTransport(api, options.chatId, options.draftId);

  trace(`begin profile=${options.profile} seed=${options.seed}`);

  const beginStartedAt = performance.now();

  await transport.begin();

  trace(
    `begin ok duration=${Math.round(performance.now() - beginStartedAt)}ms`,
  );

  const random = createRandom(options.seed);

  /*
   * This is the simulated provider clock.
   *
   * Crucially, every event has an absolute deadline. If update()
   * blocks for 300 ms, we do not add another artificial profile
   * delay afterward. Buffered provider chunks are emitted
   * immediately until the simulated source catches up.
   */
  let scheduledAt = performance.now();

  let text = "";
  let updatesReceived = 0;

  const sourceLags: number[] = [];

  for (const event of sequence(options.profile, TEXT, random)) {
    scheduledAt += event.delayMs;

    await sleepUntil(scheduledAt);

    const sourceLag = Math.max(0, performance.now() - scheduledAt);

    sourceLags.push(sourceLag);

    text += event.chunk;
    sourceChars = text.length;
    updatesReceived++;

    trace(`update received lag=${Math.round(sourceLag)}ms`, text.length);

    await transport.update(text);
  }

  trace("COMMIT", text.length);

  const commitStartedAt = performance.now();

  await transport.commit(text);

  const commitLatencyMs = performance.now() - commitStartedAt;

  const finishedAt = performance.now();

  trace(
    `done message_id=${
      transport.finalMessageId ?? "draft"
    } commit=${Math.round(commitLatencyMs)}ms`,
  );

  printSummary(
    options,
    startedAt,
    finishedAt,
    metrics,
    updatesReceived,
    sourceLags,
    commitLatencyMs,
  );
}

await main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? (error.stack ?? error.message) : error,
  );

  process.exitCode = 1;
});

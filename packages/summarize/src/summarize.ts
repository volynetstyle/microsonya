import { randomUUID } from "node:crypto";
import type { OllamaClient } from "@microsonya/model";
import {
  asSummaryId,
  asTimestampMs,
  createConversationWindow,
  type ChatId,
  type ChatMessage,
  type ConversationWindow,
  type MessageId,
  type SummaryCommand,
  type SummaryId,
  type SummaryRun,
  type TimestampMs,
  type WindowDisposition,
} from "@microsonya/shared";
import {
  createClassifier,
  type SummaryDecisionClassifier,
} from "./classifier.js";
import {
  createConversationSummarizer,
  type ConversationSummarizer,
} from "./conversationSummarizer.js";
import { DAY_MS, MAX_MESSAGES } from "./constants.js";
import { processWindow, type FastClassifier } from "./orchestrator.js";
import type { SummarizationTelemetryService } from "./telemetry.js";
import { ModelOutputError } from "./modelOutput.js";
import { shouldAdvanceCheckpoint } from "./checkpointPolicy.js";

export interface MessageReader {
  listByChat(chatId: ChatId): Promise<readonly ChatMessage[]>;
}

export interface SummaryRunStore {
  findLastRun(chatId: ChatId): Promise<SummaryRun | undefined>;
  saveRun(run: SummaryRun): Promise<void>;
}

/** Command-facing workflow facade. Model-facing contracts consume only W. */
export interface Summarizer {
  process(
    command: SummaryCommand,
    signal?: AbortSignal,
  ): Promise<WindowDisposition | null>;
}

export interface SummarizerDeps {
  readonly messages: MessageReader;
  readonly summaries: SummaryRunStore;
  readonly ollama?: Pick<OllamaClient, "chat">;
  readonly classifier?: SummaryDecisionClassifier;
  readonly conversationSummarizer?: ConversationSummarizer;
  readonly fastClassifier?: FastClassifier;
  readonly telemetry?: SummarizationTelemetryService;
  readonly createSummaryId?: () => SummaryId;
  readonly now?: () => TimestampMs;
}

export function createSummarizer(deps: SummarizerDeps): Summarizer {
  const classifier =
    deps.classifier ?? createClassifier({ ollama: requireOllama(deps) });

  const conversationSummarizer =
    deps.conversationSummarizer ??
    createConversationSummarizer({ ollama: requireOllama(deps) });

  const process = (command: SummaryCommand, signal?: AbortSignal) =>
    run(deps, classifier, conversationSummarizer, command, signal);

  return { process };
}

async function run(
  deps: SummarizerDeps,
  classifier: SummaryDecisionClassifier,
  conversationSummarizer: ConversationSummarizer,
  command: SummaryCommand,
  signal?: AbortSignal,
): Promise<WindowDisposition | null> {
  const startedAt = performance.now();
  const telemetry = deps.telemetry?.start({
    traceId: `${command.chatId}:${command.commandMessageId}:${randomUUID()}`,
    chatId: command.chatId,
    commandMessageId: command.commandMessageId,
  });
  let stage = "start";

  try {
    telemetry?.record({ type: "summary.start", mode: command.mode });
    signal?.throwIfAborted();
    stage = "messages.load";

    const [all, previous] = await Promise.all([
      deps.messages.listByChat(command.chatId),
      deps.summaries.findLastRun(command.chatId),
    ]);

    telemetry?.record({
      type: "messages.loaded",
      messageCount: all.length,
      hasPreviousRun: previous !== undefined,
    });
    signal?.throwIfAborted();
    stage = "messages.select";

    const window = selectConversationWindow(
      all,
      command,
      previous?.covers.lastId,
    );

    telemetry?.record({
      type: "messages.selected",
      messageCount: window?.messages.length ?? 0,
      fromMessageId: window?.messages[0]?.id,
      toMessageId: window?.messages.at(-1)?.id,
    });

    if (window === null) {
      telemetry?.record({
        type: "summary.finish",
        durationMs: performance.now() - startedAt,
        status: "empty",
      });
      return null;
    }

    stage = "window.process";
    const result = await processWindow(
      window,
      {
        classifier,
        summarizer: conversationSummarizer,
        fastClassifier: deps.fastClassifier,
        createSummaryId: deps.createSummaryId,
        now: deps.now,
        telemetry,
      },
      signal,
    );
    signal?.throwIfAborted();

    if (
      result.disposition.kind !== "deferred" &&
      shouldAdvanceCheckpoint(result.decision.action)
    ) {
      stage = "disposition.save";
      const saveStartedAt = performance.now();
      await deps.summaries.saveRun(
        toSummaryRun(
          window,
          command,
          result.decision.action,
          result.disposition,
          deps,
        ),
      );
      telemetry?.record({
        type: "summary.saved",
        durationMs: performance.now() - saveStartedAt,
      });
    }

    telemetry?.record({
      type: "summary.finish",
      durationMs: performance.now() - startedAt,
      status: result.disposition.kind,
    });
    return result.disposition;
  } catch (error) {
    telemetry?.record({
      type: "summary.error",
      durationMs: performance.now() - startedAt,
      stage: error instanceof ModelOutputError ? error.stage : stage,
      error: serializeError(error),
    });
    throw error;
  }
}

export function selectMessages(
  all: readonly ChatMessage[],
  command: SummaryCommand,
  lastId?: MessageId,
): ChatMessage[] {
  const eligible = all
    .filter(
      (message) =>
        message.id !== command.commandMessageId &&
        (lastId === undefined || message.id > lastId) &&
        message.text.trim().length > 0,
    )
    .sort(compareChronologically);

  if (command.mode === "count") {
    const count = Math.max(1, command.count ?? 100);
    return eligible.slice(-count);
  }

  const since =
    command.mode === "today"
      ? new Date(command.date).setHours(0, 0, 0, 0)
      : command.date - DAY_MS;

  return eligible
    .filter((message) => message.time >= since)
    .slice(-MAX_MESSAGES);
}

export function selectConversationWindow(
  all: readonly ChatMessage[],
  command: SummaryCommand,
  lastId?: MessageId,
): ConversationWindow | null {
  const messages = selectMessages(all, command, lastId);
  return messages.length === 0 ? null : createConversationWindow(messages);
}

export function presentDisposition(disposition: WindowDisposition): string {
  switch (disposition.kind) {
    case "summarized":
      return disposition.summary.text;
    case "deferred":
      return DEFER_PRESENTATION[disposition.reason];
    case "skipped":
      return SKIP_PRESENTATION[disposition.reason];
  }
}

const DEFER_PRESENTATION = {
  DEFER_COMPACT:
    "У цих повідомленнях є корисна інформація, але вона вже достатньо стисла. Залишаю її для наступного підсумку.",
  DEFER_INCOMPLETE:
    "Обговорення ще розвивається. Зачекаю на результат або уточнення, щоб підсумок був кориснішим.",
  DEFER_CONTEXT:
    "У видимих повідомленнях бракує контексту для надійного підсумку без здогадок. Залишаю їх для наступного вікна.",
} as const;

const SKIP_PRESENTATION = {
  SKIP_REACTIONS:
    "Тут переважно короткі реакції та підтвердження, тож окремий підсумок не створюю.",
  SKIP_BANTER:
    "Тут переважно невимушене спілкування без інформації, яку варто переносити в історію підсумків.",
  SKIP_NO_VALUE:
    "У цьому вікні поки немає достатньо конкретної інформації для корисного підсумку.",
} as const;

function toSummaryRun(
  window: ConversationWindow,
  command: SummaryCommand,
  action: SummaryRun["action"],
  disposition: Exclude<WindowDisposition, { kind: "deferred" }>,
  deps: Pick<SummarizerDeps, "createSummaryId" | "now">,
): SummaryRun {
  const covers = Object.freeze({
    firstId: window.messages[0]!.id,
    lastId: window.messages.at(-1)!.id,
    count: window.messages.length,
  });

  if (disposition.kind === "summarized") {
    return Object.freeze({
      id: disposition.summary.id,
      chatId: disposition.summary.chatId,
      commandMessageId: command.commandMessageId,
      createdAt: disposition.summary.createdAt,
      covers: disposition.summary.covers,
      mode: command.mode,
      status: "summarized",
      action,
      finalText: disposition.summary.text,
    });
  }

  return Object.freeze({
    id: (deps.createSummaryId ?? defaultSummaryId)(),
    chatId: window.chatId,
    commandMessageId: command.commandMessageId,
    createdAt: (deps.now ?? defaultNow)(),
    covers,
    mode: command.mode,
    status: "skipped",
    action,
    finalText: presentDisposition(disposition),
  });
}

function compareChronologically(left: ChatMessage, right: ChatMessage): number {
  return left.time - right.time || left.id - right.id;
}

function requireOllama(deps: SummarizerDeps): Pick<OllamaClient, "chat"> {
  if (!deps.ollama) {
    throw new TypeError(
      "createSummarizer requires ollama when model-facing dependencies are not injected.",
    );
  }
  return deps.ollama;
}

function defaultSummaryId(): SummaryId {
  return asSummaryId(randomUUID());
}

function defaultNow(): TimestampMs {
  return asTimestampMs(Date.now());
}

function serializeError(error: unknown): {
  name?: string;
  code?: string;
  outputChars?: number;
  outputPreview?: string;
  message: string;
  stack?: string;
} {
  if (error instanceof Error) {
    return {
      name: error.name,
      ...(error instanceof ModelOutputError
        ? {
            code: error.code,
            outputChars: error.outputChars,
            ...(includeModelOutputInLogs()
              ? { outputPreview: error.outputPreview }
              : {}),
          }
        : {}),
      message: error.message,
      stack: error.stack,
    };
  }
  return { message: String(error) };
}

function includeModelOutputInLogs(): boolean {
  return (
    process.env.NODE_ENV === "development" ||
    process.env.SUMMARIZATION_LOG_MODEL_RESPONSE === "1"
  );
}

import { randomUUID } from "node:crypto";
import { OllamaError, type OllamaClient } from "@microsonya/model";
import {
  asSummaryId,
  asTimestampMs,
  createConversationWindow,
  type ChatId,
  type ChatMessage,
  type ConversationWindow,
  type MessageId,
  type SummaryAction,
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
import type {
  SummarizationTelemetryService,
  SummaryErrorCode,
} from "./telemetry.js";
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

export interface WindowMessage {
  readonly message: ChatMessage;
  readonly role: "eligible" | "context";
}

export interface SelectedConversation {
  readonly window: ConversationWindow;
  readonly messages: readonly WindowMessage[];
  readonly eligibleMessages: readonly ChatMessage[];
  readonly contextMessages: readonly ChatMessage[];
}

export function createSummarizer(deps: SummarizerDeps): Summarizer {
  const classifier =
    deps.classifier ?? createClassifier({ ollama: requireOllama(deps) });

  const conversationSummarizer =
    deps.conversationSummarizer ??
    createConversationSummarizer({ ollama: requireOllama(deps) });

  const pendingByChat = new Map<ChatId, Promise<void>>();
  const deferStreakByChat = new Map<
    ChatId,
    { readonly checkpoint?: MessageId; readonly count: number }
  >();
  const process = (command: SummaryCommand, signal?: AbortSignal) =>
    serializeByChat(pendingByChat, command.chatId, () =>
      run(
        deps,
        classifier,
        conversationSummarizer,
        deferStreakByChat,
        command,
        signal,
      ),
    );

  return { process };
}

async function serializeByChat<T>(
  pendingByChat: Map<ChatId, Promise<void>>,
  chatId: ChatId,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = pendingByChat.get(chatId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  const tail = current.then(
    () => undefined,
    () => undefined,
  );
  pendingByChat.set(chatId, tail);
  try {
    return await current;
  } finally {
    if (pendingByChat.get(chatId) === tail) pendingByChat.delete(chatId);
  }
}

async function run(
  deps: SummarizerDeps,
  classifier: SummaryDecisionClassifier,
  conversationSummarizer: ConversationSummarizer,
  deferStreakByChat: Map<
    ChatId,
    { readonly checkpoint?: MessageId; readonly count: number }
  >,
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
  let action: SummaryAction | undefined;
  let messageCount = 0;
  let contextMessageCount = 0;
  let checkpointAdvanced = false;
  let consecutiveDeferCount = 0;

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

    const selected = selectConversationWindow(
      all,
      command,
      previous?.covers.lastId,
    );
    messageCount = selected?.eligibleMessages.length ?? 0;
    contextMessageCount = selected?.contextMessages.length ?? 0;

    telemetry?.record({
      type: "messages.selected",
      messageCount: selected?.eligibleMessages.length ?? 0,
      contextMessageCount: selected?.contextMessages.length ?? 0,
      fromMessageId: selected?.eligibleMessages[0]?.id,
      toMessageId: selected?.eligibleMessages.at(-1)?.id,
    });

    if (selected === null) {
      deferStreakByChat.delete(command.chatId);
      telemetry?.record({
        type: "summary.finish",
        durationMs: performance.now() - startedAt,
        status: "empty",
      });
      recordRun("empty");
      return null;
    }

    stage = "window.process";
    const result = await processWindow(
      selected.window,
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
    action = result.decision.action;
    const disposition = withEligibleCoverage(
      result.disposition,
      selected.eligibleMessages,
    );

    if (disposition.kind === "deferred") {
      const checkpoint = previous?.covers.lastId;
      const prior = deferStreakByChat.get(command.chatId);
      consecutiveDeferCount =
        prior && prior.checkpoint === checkpoint ? prior.count + 1 : 1;
      deferStreakByChat.set(command.chatId, {
        checkpoint,
        count: consecutiveDeferCount,
      });
    }

    if (
      disposition.kind !== "deferred" &&
      shouldAdvanceCheckpoint(result.decision.action)
    ) {
      stage = "disposition.save";
      const saveStartedAt = performance.now();
      await deps.summaries.saveRun(
        toSummaryRun(
          selected,
          command,
          result.decision.action,
          disposition,
          deps,
        ),
      );
      checkpointAdvanced = true;
      deferStreakByChat.delete(command.chatId);
      telemetry?.record({
        type: "summary.saved",
        durationMs: performance.now() - saveStartedAt,
      });
    }

    telemetry?.record({
      type: "summary.finish",
      durationMs: performance.now() - startedAt,
      status: disposition.kind,
    });
    recordRun(disposition.kind);
    return disposition;
  } catch (error) {
    const errorCode = classifySummaryError(error, stage);
    telemetry?.record({
      type: "summary.error",
      durationMs: performance.now() - startedAt,
      stage: error instanceof ModelOutputError ? error.stage : stage,
      error: serializeError(error, errorCode),
    });
    recordRun("error", errorCode);
    throw error;
  }

  function recordRun(
    status: "summarized" | "deferred" | "skipped" | "empty" | "error",
    errorCode?: SummaryErrorCode,
  ): void {
    const model = telemetry?.modelMetrics() ?? {
      modelCalls: 0,
      classifierMs: 0,
      summarizerMs: 0,
    };
    telemetry?.record({
      type: "summary.run",
      action,
      messageCount,
      contextMessageCount,
      classifierMs: model.classifierMs,
      summarizerMs: model.summarizerMs,
      totalMs: performance.now() - startedAt,
      modelCalls: model.modelCalls,
      checkpointAdvanced,
      consecutiveDeferCount,
      status,
      errorCode,
    });
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
): SelectedConversation | null {
  const eligibleMessages = selectMessages(all, command, lastId);
  if (eligibleMessages.length === 0) return null;

  // A reply may cross the checkpoint. Include its direct parent as read-only
  // context even though the parent itself was covered by an earlier run.
  const selectedIds = new Set(eligibleMessages.map(({ id }) => id));
  const byId = new Map(all.map((message) => [message.id, message]));
  const contextMessages = eligibleMessages.flatMap(({ parentId }) => {
    if (parentId === null || selectedIds.has(parentId)) return [];
    const parent = byId.get(parentId);
    return parent === undefined ? [] : [parent];
  });
  const withReplyContext = [
    ...new Map(
      [...contextMessages, ...eligibleMessages].map((message) => [
        message.id,
        message,
      ]),
    ).values(),
  ].sort(compareChronologically);

  const contextIds = new Set(contextMessages.map(({ id }) => id));
  return Object.freeze({
    window: createConversationWindow(withReplyContext),
    messages: Object.freeze(
      withReplyContext.map((message) =>
        Object.freeze({
          message,
          role: contextIds.has(message.id)
            ? ("context" as const)
            : ("eligible" as const),
        }),
      ),
    ),
    eligibleMessages: Object.freeze([...eligibleMessages]),
    contextMessages: Object.freeze(
      withReplyContext.filter(({ id }) => contextIds.has(id)),
    ),
  });
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
  selected: SelectedConversation,
  command: SummaryCommand,
  action: SummaryRun["action"],
  disposition: Exclude<WindowDisposition, { kind: "deferred" }>,
  deps: Pick<SummarizerDeps, "createSummaryId" | "now">,
): SummaryRun {
  const messages = selected.eligibleMessages;
  const covers = Object.freeze({
    firstId: messages[0]!.id,
    lastId: messages.at(-1)!.id,
    count: messages.length,
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
    chatId: selected.window.chatId,
    commandMessageId: command.commandMessageId,
    createdAt: (deps.now ?? defaultNow)(),
    covers,
    mode: command.mode,
    status: "skipped",
    action,
    finalText: presentDisposition(disposition),
  });
}

function withEligibleCoverage(
  disposition: WindowDisposition,
  eligibleMessages: readonly ChatMessage[],
): WindowDisposition {
  if (disposition.kind !== "summarized") return disposition;
  return Object.freeze({
    kind: "summarized" as const,
    summary: Object.freeze({
      ...disposition.summary,
      covers: Object.freeze({
        firstId: eligibleMessages[0]!.id,
        lastId: eligibleMessages.at(-1)!.id,
        count: eligibleMessages.length,
      }),
    }),
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

function serializeError(
  error: unknown,
  code: SummaryErrorCode,
): {
  name?: string;
  code: SummaryErrorCode;
  detailCode?: string;
  outputChars?: number;
  outputPreview?: string;
  message: string;
  stack?: string;
} {
  if (error instanceof Error) {
    return {
      code,
      name: error.name,
      ...(error instanceof ModelOutputError
        ? {
            detailCode: error.code,
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
  return { code, message: String(error) };
}

export function classifySummaryError(
  error: unknown,
  stage: string,
): SummaryErrorCode {
  if (stage === "delivery") return "DELIVERY_ERROR";
  if (error instanceof ModelOutputError) {
    return error.code === "MODEL_OUTPUT_EMPTY"
      ? "MODEL_OUTPUT_EMPTY"
      : "MODEL_OUTPUT_INVALID";
  }
  if (
    error instanceof DOMException
      ? error.name === "AbortError" || error.name === "TimeoutError"
      : error instanceof Error &&
        (error.name === "AbortError" || error.name === "TimeoutError")
  ) {
    return "MODEL_TIMEOUT";
  }
  if (stage === "messages.load" || stage === "disposition.save") {
    return "STORAGE_ERROR";
  }
  if (error instanceof OllamaError || stage === "window.process") {
    return "MODEL_PROVIDER_ERROR";
  }
  return "STORAGE_ERROR";
}

function includeModelOutputInLogs(): boolean {
  return (
    process.env.NODE_ENV === "development" ||
    process.env.SUMMARIZATION_LOG_MODEL_RESPONSE === "1"
  );
}

import { createHash, randomUUID } from "node:crypto";
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
  type SummaryRunAttempt,
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
  SummarizationTelemetryTrace,
  SummaryErrorCode,
} from "./telemetry.js";
import { ModelOutputError } from "./modelOutput.js";
import {
  CHECKPOINT_POLICY_VERSION,
  shouldAdvanceCheckpoint,
} from "./checkpointPolicy.js";

export interface MessageReader {
  listByChat(chatId: ChatId): Promise<readonly ChatMessage[]>;
}

export interface SummaryRunStore {
  findLastRun(chatId: ChatId): Promise<SummaryRun | undefined>;
  saveRun(run: SummaryRun): Promise<void>;
  saveAttempt?(attempt: SummaryRunAttempt): Promise<void>;
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

const EMPTY_MODEL_METRICS = Object.freeze({
  modelCalls: 0,
  classifierMs: 0,
  summarizerMs: 0,
});

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
  const now = deps.now ?? defaultNow;
  const createSummaryId = deps.createSummaryId ?? defaultSummaryId;
  const startedWallClock = now();
  const elapsed = () => performance.now() - startedAt;
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
  let checkpointBefore: MessageId | null = null;
  let selected: SelectedConversation | null = null;
  let attemptPersisted = false;

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

    checkpointBefore = previous?.covers.lastId ?? null;
    selected = selectConversationWindow(all, command, previous?.covers.lastId);
    messageCount = selected?.eligibleMessages.length ?? 0;
    contextMessageCount = selected?.contextMessages.length ?? 0;

    telemetry?.record({
      type: "messages.selected",
      messageCount: selected?.eligibleMessages.length ?? 0,
      contextMessageCount: selected?.contextMessages.length ?? 0,
      fromMessageId: selected?.eligibleMessages[0]?.id,
      toMessageId:
        selected?.eligibleMessages[selected.eligibleMessages.length - 1]?.id,
    });

    if (selected === null) {
      deferStreakByChat.delete(command.chatId);
      telemetry?.record({
        type: "summary.finish",
        durationMs: elapsed(),
        status: "empty",
      });
      stage = "attempt.save";
      await persistAttempt("empty");
      attemptPersisted = true;
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
      const terminalRun = toSummaryRun(
        selected,
        command,
        result.decision.action,
        disposition,
        deps,
      );
      stage = "attempt.save";
      await persistAttempt(disposition.kind, undefined, terminalRun);
      attemptPersisted = true;
      checkpointAdvanced = true;
      deferStreakByChat.delete(command.chatId);
      telemetry?.record({
        type: "summary.saved",
        durationMs: performance.now() - saveStartedAt,
      });
    }

    telemetry?.record({
      type: "summary.finish",
      durationMs: elapsed(),
      status: disposition.kind,
    });
    if (!attemptPersisted) {
      stage = "attempt.save";
      await persistAttempt(disposition.kind);
      attemptPersisted = true;
    }
    recordRun(disposition.kind);
    return disposition;
  } catch (error) {
    const errorCode = classifySummaryError(error, stage);
    telemetry?.record({
      type: "summary.error",
      durationMs: elapsed(),
      stage: error instanceof ModelOutputError ? error.stage : stage,
      error: serializeError(error, errorCode),
    });
    if (!attemptPersisted && stage !== "attempt.save") {
      try {
        await persistAttempt("error", errorCode);
        attemptPersisted = true;
      } catch (ledgerError) {
        console.error(
          "Failed to persist summary attempt evidence",
          ledgerError,
        );
      }
    }
    recordRun("error", errorCode);
    throw error;
  }

  async function persistAttempt(
    status: SummaryRunAttempt["status"],
    errorCode?: SummaryErrorCode,
    terminalRun?: SummaryRun,
  ): Promise<void> {
    if (deps.summaries.saveAttempt === undefined) {
      if (terminalRun !== undefined) await deps.summaries.saveRun(terminalRun);
      return;
    }

    const completedAt = now();
    const model = modelMetrics(telemetry);
    const modelInvocations = telemetry?.modelInvocations(errorCode) ?? [];
    const snapshots = snapshotMessages(selected?.messages ?? []);
    const inputHash = hashInput(snapshots);
    const classifierInvocation = [...modelInvocations]
      .reverse()
      .find(({ stage: invocationStage }) => invocationStage === "classifier");
    const summarizerInvocation = [...modelInvocations]
      .reverse()
      .find(({ stage: invocationStage }) => invocationStage === "summarizer");
    const checkpointAfter = terminalRun?.covers.lastId ?? checkpointBefore;
    const summaryText = terminalRun?.finalText;

    await deps.summaries.saveAttempt(
      Object.freeze({
        id: terminalRun?.id ?? createSummaryId(),
        chatId: command.chatId,
        commandMessageId: command.commandMessageId,
        startedAt: startedWallClock,
        completedAt,
        checkpointBefore,
        checkpointAfter,
        eligibleCount: messageCount,
        contextCount: contextMessageCount,
        mode: command.mode,
        action,
        status,
        classifierModel: classifierInvocation?.model,
        summarizerModel: summarizerInvocation?.model,
        classifierPromptHash: classifierInvocation?.promptHash,
        summaryPromptHash: summarizerInvocation?.promptHash,
        policyHash: sha256(CHECKPOINT_POLICY_VERSION),
        classifierLatencyMs: model.classifierMs,
        summarizerLatencyMs: model.summarizerMs,
        totalLatencyMs: elapsed(),
        summaryText,
        errorCode,
        inputHash,
        messages: snapshots,
        modelInvocations,
        candidate: mineDatasetCandidate({
          action,
          status,
          consecutiveDeferCount,
          snapshots,
          inputHash,
        }),
      }),
    );
  }

  function recordRun(
    status: "summarized" | "deferred" | "skipped" | "empty" | "error",
    errorCode?: SummaryErrorCode,
  ): void {
    const model = modelMetrics(telemetry);
    telemetry?.record({
      type: "summary.run",
      action,
      messageCount,
      contextMessageCount,
      classifierMs: model.classifierMs,
      summarizerMs: model.summarizerMs,
      totalMs: elapsed(),
      modelCalls: model.modelCalls,
      checkpointAdvanced,
      consecutiveDeferCount,
      status,
      errorCode,
    });
  }
}

function hashInput(snapshots: SummaryRunAttempt["messages"]): string {
  return sha256(JSON.stringify(snapshots));
}

function snapshotMessages(
  messages: readonly WindowMessage[],
): SummaryRunAttempt["messages"] {
  return Object.freeze(
    messages.map(({ message, role }, ordinal) =>
      Object.freeze({
        ordinal,
        chatId: message.chatId,
        messageId: message.id,
        role,
        authorId: message.author.id,
        authorName: message.author.label,
        text: message.text,
        sentAt: message.time,
        replyToId: message.parentId,
      }),
    ),
  );
}

function modelMetrics(telemetry?: SummarizationTelemetryTrace) {
  return telemetry?.modelMetrics() ?? EMPTY_MODEL_METRICS;
}

function mineDatasetCandidate(input: {
  action?: SummaryAction;
  status: SummaryRunAttempt["status"];
  consecutiveDeferCount: number;
  snapshots: SummaryRunAttempt["messages"];
  inputHash: string;
}): SummaryRunAttempt["candidate"] {
  const reasons = new Set<string>();
  let priority = 0;
  const eligibleText = input.snapshots
    .filter(({ role }) => role === "eligible")
    .map(({ text }) => text)
    .join("\n");

  if (input.status === "error") {
    reasons.add("RUN_ERROR");
    priority += 100;
  }

  if (input.consecutiveDeferCount >= 3) {
    reasons.add("DEFER_STREAK");
    priority += input.consecutiveDeferCount * 10;
  }
  if (input.snapshots.some(({ role }) => role === "context")) {
    reasons.add("REPLY_PROVENANCE");
    priority += 5;
  }
  const numericTokens = eligibleText.match(/\b\d+(?:[.:,]\d+)?\b/g) ?? [];
  if (numericTokens.length >= 3) {
    reasons.add("NUMERIC_RICH");
    priority += 5;
  }
  if (
    input.action?.startsWith("SKIP_") &&
    (eligibleText.length >= 500 || numericTokens.length >= 3)
  ) {
    reasons.add("SKIP_HIGH_INFORMATION");
    priority += 100;
  }

  const sampleBucket = Number.parseInt(input.inputHash.slice(0, 8), 16) % 100;
  if (reasons.size === 0) {
    const sampleRate = input.status === "deferred" ? 20 : 3;
    if (sampleBucket < sampleRate) {
      reasons.add(
        input.status === "deferred" ? "BOUNDARY_SAMPLE" : "NORMAL_SAMPLE",
      );
      priority += 1;
    }
  }

  return reasons.size === 0
    ? undefined
    : Object.freeze({ priority, reasons: Object.freeze([...reasons]) });
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function selectMessages(
  all: readonly ChatMessage[],
  command: SummaryCommand,
  lastId?: MessageId,
): ChatMessage[] {
  const since =
    command.mode === "today"
      ? new Date(command.date).setHours(0, 0, 0, 0)
      : command.date - DAY_MS;
  const eligible: ChatMessage[] = [];

  for (const message of all) {
    if (
      message.id === command.commandMessageId ||
      (lastId !== undefined && message.id <= lastId) ||
      message.text.trim().length === 0 ||
      (command.mode !== "count" && message.time < since)
    ) {
      continue;
    }
    eligible.push(message);
  }
  eligible.sort(compareChronologically);

  const limit =
    command.mode === "count" ? Math.max(1, command.count ?? 100) : MAX_MESSAGES;
  return eligible.length > limit ? eligible.slice(-limit) : eligible;
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
  const neededParentIds = new Set<MessageId>();
  for (const { parentId } of eligibleMessages) {
    if (parentId !== null && !selectedIds.has(parentId)) {
      neededParentIds.add(parentId);
    }
  }
  const contextMessages: ChatMessage[] = [];
  if (neededParentIds.size > 0) {
    for (const message of all) {
      if (!neededParentIds.has(message.id)) continue;
      contextMessages.push(message);
      if (contextMessages.length === neededParentIds.size) break;
    }
    contextMessages.sort(compareChronologically);
  }
  const withReplyContext =
    contextMessages.length === 0
      ? eligibleMessages
      : [...contextMessages, ...eligibleMessages].sort(compareChronologically);
  return Object.freeze({
    window: createConversationWindow(withReplyContext),
    messages: Object.freeze(
      withReplyContext.map((message) =>
        Object.freeze({
          message,
          role: neededParentIds.has(message.id)
            ? ("context" as const)
            : ("eligible" as const),
        }),
      ),
    ),
    eligibleMessages: Object.freeze(eligibleMessages),
    contextMessages: Object.freeze(contextMessages),
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
  const covers = coverageOf(messages);

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
  const covers = coverageOf(eligibleMessages);
  if (sameCoverage(disposition.summary.covers, covers)) return disposition;
  return Object.freeze({
    kind: "summarized" as const,
    summary: Object.freeze({
      ...disposition.summary,
      covers,
    }),
  });
}

function coverageOf(messages: readonly ChatMessage[]) {
  return Object.freeze({
    firstId: messages[0]!.id,
    lastId: messages.at(-1)!.id,
    count: messages.length,
  });
}

function sameCoverage(
  left: ReturnType<typeof coverageOf>,
  right: ReturnType<typeof coverageOf>,
): boolean {
  return (
    left.firstId === right.firstId &&
    left.lastId === right.lastId &&
    left.count === right.count
  );
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

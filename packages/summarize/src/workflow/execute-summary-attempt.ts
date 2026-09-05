import { randomUUID } from "node:crypto";
import { OllamaError, type OllamaClient } from "@microsonya/model";
import {
  asSummaryId,
  asTimestampMs,
  type ChatId,
  type ConversationWindow,
  type MessageId,
  type SummaryAction,
  type SummaryCommand,
  type SummaryId,
  type SummaryAttempt,
  type AcceptedOutcomeRecord,
  type TimestampMs,
  type WindowDisposition,
} from "@microsonya/shared";
import {
  createClassifier,
  type SummaryDecisionClassifier,
} from "../evaluation/classify-conversation.js";
import {
  createConversationSummarizer,
  type ConversationSummarizer,
} from "../evaluation/generate-summary.js";
import {
  processWindow,
  type FastClassifier,
  type WindowProcessorDeps,
} from "../evaluation/evaluate-conversation.js";
import type {
  SummarizationTelemetryService,
  SummarizationTelemetryTrace,
  SummaryErrorCode,
} from "./telemetry.js";
import { ModelOutputError } from "../evaluation/model-output.js";
import { validateSemanticOutput } from "../acceptance/validate-semantic-output.js";
import { shouldAdvanceCheckpoint } from "../acceptance/consumption-policy.js";
import {
  pendingSummaryWindowSelector,
  type SelectedConversation,
  type SummaryWindowSelector,
  type WindowMessage,
} from "../selection/select-conversation.js";
import { acceptOutcome } from "../acceptance/accept-outcome.js";
import { AttemptCommitConflict } from "./attempt-commit.js";
import type {
  Summarizer,
  SummarizerDeps,
  SummaryAttemptStore,
} from "./ports.js";
import { buildAttemptRecord } from "./build-attempt-record.js";
export type {
  SelectedConversation,
  SummaryWindowSelector,
  WindowMessage,
} from "../selection/select-conversation.js";

const EMPTY_MODEL_METRICS = Object.freeze({
  modelCalls: 0,
  classifierMs: 0,
  summarizerMs: 0,
});

export function createSummaryWorkflow(deps: SummarizerDeps): Summarizer {
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
      findLatestConsumptionBoundary(deps.summaries, command.chatId),
    ]);

    telemetry?.record({
      type: "messages.loaded",
      messageCount: all.length,
      hasPreviousRun: previous !== undefined,
    });
    signal?.throwIfAborted();
    stage = "messages.select";

    checkpointBefore = previous?.covers.lastId ?? null;
    selected = (deps.windowSelector ?? pendingSummaryWindowSelector).select({
      messages: all,
      command,
      checkpointBefore: previous?.covers.lastId,
    });
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
        roles: selected.messages,
        eligibleMessages: selected.eligibleMessages,
        progressive: deps.progressive,
      },
      signal,
    );
    signal?.throwIfAborted();
    action = result.decision.action;
    const disposition = result.disposition;
    stage = "outcome.accept";
    if (disposition.kind === "summarized") {
      validateSemanticOutput(disposition.summary.text);
    }

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

    const acceptedOutcome =
      disposition.kind === "summarized"
        ? acceptOutcome({
            selected,
            command,
            action: result.decision.action,
            disposition,
            createSummaryId,
            now,
          })
        : undefined;

    if (
      disposition.kind !== "deferred" &&
      selected.consumption === "checkpoint" &&
      shouldAdvanceCheckpoint(result.decision.action)
    ) {
      stage = "disposition.save";
      const saveStartedAt = performance.now();
      stage = "attempt.save";
      await persistAttempt(
        disposition.kind,
        undefined,
        acceptedOutcome ??
          acceptOutcome({
            selected,
            command,
            action: result.decision.action,
            disposition,
            createSummaryId,
            now,
          }),
      );
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
      await persistAttempt(disposition.kind, undefined, acceptedOutcome);
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
    status: SummaryAttempt["status"],
    errorCode?: SummaryErrorCode,
    acceptedOutcome?: AcceptedOutcomeRecord,
  ): Promise<void> {
    const recordAttempt =
      deps.summaries.recordAttempt ?? deps.summaries.saveAttempt;
    if (recordAttempt === undefined) {
      if (acceptedOutcome !== undefined)
        await recordAcceptedOutcome(deps.summaries, acceptedOutcome);
      return;
    }

    const completedAt = now();
    const model = modelMetrics(telemetry);
    const modelInvocations = telemetry?.modelInvocations(errorCode) ?? [];
    const classifierInvocation = [...modelInvocations]
      .reverse()
      .find(({ stage: invocationStage }) => invocationStage === "classifier");
    const summarizerInvocation = [...modelInvocations]
      .reverse()
      .find(({ stage: invocationStage }) => invocationStage === "summarizer");
    const consumedThroughMessageId =
      selected?.consumption === "checkpoint"
        ? (acceptedOutcome?.covers.lastId ?? checkpointBefore)
        : checkpointBefore;
    const summaryText = acceptedOutcome?.finalText;

    const recorded = await recordAttempt.call(
      deps.summaries,
      buildAttemptRecord({
        id: acceptedOutcome?.id ?? createSummaryId(),
        chatId: command.chatId,
        commandMessageId: command.commandMessageId,
        startedAt: startedWallClock,
        completedAt,
        checkpointBefore,
        consumedThroughMessageId,
        eligibleCount: messageCount,
        contextCount: contextMessageCount,
        mode: command.mode,
        action,
        status,
        classifierModel: classifierInvocation?.model,
        summarizerModel: summarizerInvocation?.model,
        classifierPromptHash: classifierInvocation?.promptHash,
        summaryPromptHash: summarizerInvocation?.promptHash,
        classifierLatencyMs: model.classifierMs,
        summarizerLatencyMs: model.summarizerMs,
        totalLatencyMs: elapsed(),
        summaryText,
        errorCode,
        selectedMessages: selected?.messages ?? [],
        consecutiveDeferCount,
        modelInvocations,
      }),
    );
    if (recorded !== undefined && recorded.status !== "committed") {
      throw new AttemptCommitConflict(recorded);
    }
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

function findLatestConsumptionBoundary(
  store: SummaryAttemptStore,
  chatId: ChatId,
): Promise<Pick<AcceptedOutcomeRecord, "covers"> | undefined> {
  const find = store.findLatestConsumptionBoundary ?? store.findLastRun;
  if (find === undefined) {
    throw new TypeError(
      "Summary attempt store cannot read consumption boundary.",
    );
  }
  return find.call(store, chatId);
}

function recordAcceptedOutcome(
  store: SummaryAttemptStore,
  outcome: AcceptedOutcomeRecord,
): Promise<void> {
  const record = store.recordAcceptedOutcome ?? store.saveRun;
  if (record === undefined) {
    throw new TypeError(
      "Summary attempt store cannot record accepted outcome.",
    );
  }
  return record.call(store, outcome);
}

function modelMetrics(telemetry?: SummarizationTelemetryTrace) {
  return telemetry?.modelMetrics() ?? EMPTY_MODEL_METRICS;
}

function requireOllama(deps: SummarizerDeps): Pick<OllamaClient, "chat"> {
  if (!deps.ollama) {
    throw new TypeError(
      "createSummaryWorkflow requires ollama when model-facing dependencies are not injected.",
    );
  }
  return deps.ollama;
}

/** @deprecated Use createSummaryWorkflow. */
export const createSummarizer = createSummaryWorkflow;

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

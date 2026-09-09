import type {
  ChatId,
  MessageId,
  SummaryAction,
  SummaryCommand,
  WindowDisposition,
} from "@microsonya/shared";
import type { SummaryDecisionClassifier } from "../classifier/classifier.js";
import { SummaryAcceptanceError } from "../generation/acceptance.js";
import type { ConversationSummarizer } from "../generation/summarizer.js";
import type { SummarySemanticReviewer } from "../generation/reviewer.js";
import { validateSemanticOutput } from "../generation/validation.js";
import { ModelOutputError } from "../model/output.js";
import type { SummaryWorkflowDependencies } from "../summary.dependencies.js";
import { evaluateSummaryWindow } from "../summary.evaluation.js";
import { identifySummaryInput } from "../summary.input.js";
import { acceptOutcome } from "../summary.outcome.js";
import { defaultSummaryWindowSelector } from "../summary.window.js";
import { shouldAdvanceCheckpoint } from "../window/consumption.js";
import type { SelectedConversation } from "../window/selection.js";
import { classifySummaryError, serializeError } from "./errors.js";
import {
  dispositionFromReusableOutcome,
  findReusableOutcome,
} from "./reuse.js";
import { SummaryAttemptRecorder } from "./SummaryAttemptRecorder.js";

export async function executeSummaryAttempt(
  deps: SummaryWorkflowDependencies & {
    readonly semanticReviewer: SummarySemanticReviewer;
  },
  classifier: SummaryDecisionClassifier,
  conversationSummarizer: ConversationSummarizer,
  deferStreakByChat: Map<
    ChatId,
    { readonly checkpoint?: MessageId; readonly count: number }
  >,
  command: SummaryCommand,
  signal?: AbortSignal,
): Promise<WindowDisposition | null> {
  let stage = "start";
  let action: SummaryAction | undefined;
  let messageCount = 0;
  let contextMessageCount = 0;
  let checkpointAdvanced = false;
  let consecutiveDeferCount = 0;
  let checkpointBefore: MessageId | null = null;
  let selected: SelectedConversation | null = null;
  let attemptPersisted = false;

  const attempt = new SummaryAttemptRecorder(deps, command, () => ({
    action,
    messageCount,
    contextMessageCount,
    checkpointAdvanced,
    consecutiveDeferCount,
    checkpointBefore,
    selected,
  }));
  const { execution, now, createSummaryId } = attempt;
  const elapsed = () => attempt.elapsed();
  try {
    execution.record({ type: "summary.start", mode: command.mode });
    signal?.throwIfAborted();
    stage = "messages.load";

    const [all, previous] = await Promise.all([
      deps.messages.listByChat(command.chatId),
      deps.summaries.findLatestConsumptionBoundary(command.chatId),
    ]);

    execution.record({
      type: "messages.loaded",
      messageCount: all.length,
      hasPreviousRun: previous !== undefined,
    });
    signal?.throwIfAborted();
    stage = "messages.select";

    checkpointBefore = previous?.covers.lastId ?? null;
    selected = (deps.windowSelector ?? defaultSummaryWindowSelector).select({
      messages: all,
      command,
      checkpointBefore: previous?.covers.lastId,
    });
    messageCount = selected?.eligibleMessages.length ?? 0;
    contextMessageCount = selected?.contextMessages.length ?? 0;

    execution.record({
      type: "messages.selected",
      messageCount: selected?.eligibleMessages.length ?? 0,
      contextMessageCount: selected?.contextMessages.length ?? 0,
      fromMessageId: selected?.eligibleMessages[0]?.id,
      toMessageId:
        selected?.eligibleMessages[selected.eligibleMessages.length - 1]?.id,
    });

    if (selected === null) {
      deferStreakByChat.delete(command.chatId);
      execution.record({
        type: "summary.finish",
        durationMs: elapsed(),
        status: "empty",
      });
      stage = "attempt.save";
      await attempt.persist("empty");
      attemptPersisted = true;
      attempt.recordRun("empty");
      return null;
    }

    const reusable = await findReusableOutcome(
      deps.summaries,
      identifySummaryInput(selected),
    );
    if (reusable !== undefined) {
      action = reusable.action;
      const disposition = dispositionFromReusableOutcome(
        reusable,
        selected,
        createSummaryId,
        now,
      );
      const acceptedOutcome = acceptOutcome({
        selected,
        command,
        action,
        disposition,
        createSummaryId,
        now,
      });
      if (
        selected.consumption === "checkpoint" &&
        shouldAdvanceCheckpoint(action)
      ) {
        checkpointAdvanced = true;
        deferStreakByChat.delete(command.chatId);
      }
      stage = "attempt.save";
      await attempt.persist(disposition.kind, undefined, acceptedOutcome);
      attemptPersisted = true;
      execution.record({
        type: "summary.finish",
        durationMs: elapsed(),
        status: disposition.kind,
      });
      attempt.recordRun(disposition.kind);
      return disposition;
    }

    stage = "window.process";
    const result = await evaluateSummaryWindow(
      selected.window,
      {
        classifier,
        summarizer: conversationSummarizer,
        semanticReviewer: deps.semanticReviewer,
        fastClassifier: deps.fastClassifier,
        createSummaryId: deps.createSummaryId,
        now: deps.now,
        execution,
        roles: selected.messages,
        eligibleMessages: selected.eligibleMessages,
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

    const advancesCheckpoint =
      selected.consumption === "checkpoint" &&
      shouldAdvanceCheckpoint(result.decision.action);
    const acceptance = {
      selected,
      command,
      action: result.decision.action,
      createSummaryId,
      now,
    };
    const acceptedOutcome =
      disposition.kind === "summarized"
        ? acceptOutcome({ ...acceptance, disposition })
        : undefined;

    if (disposition.kind !== "deferred" && advancesCheckpoint) {
      stage = "disposition.save";
      const saveStartedAt = performance.now();
      stage = "attempt.save";
      await attempt.persist(
        disposition.kind,
        undefined,
        acceptedOutcome ?? acceptOutcome({ ...acceptance, disposition }),
      );
      attemptPersisted = true;
      checkpointAdvanced = true;
      deferStreakByChat.delete(command.chatId);
      execution.record({
        type: "summary.saved",
        durationMs: performance.now() - saveStartedAt,
      });
    }

    execution.record({
      type: "summary.finish",
      durationMs: elapsed(),
      status: disposition.kind,
    });
    if (!attemptPersisted) {
      stage = "attempt.save";
      await attempt.persist(disposition.kind, undefined, acceptedOutcome);
      attemptPersisted = true;
    }
    attempt.recordRun(disposition.kind);
    return disposition;
  } catch (error) {
    const errorCode = classifySummaryError(error, stage);
    execution.record({
      type: "summary.error",
      durationMs: elapsed(),
      stage:
        error instanceof ModelOutputError ||
        error instanceof SummaryAcceptanceError
          ? error.stage
          : stage,
      error: serializeError(error, errorCode),
    });
    if (!attemptPersisted && stage !== "attempt.save") {
      try {
        await attempt.persist("error", errorCode);
        attemptPersisted = true;
      } catch (ledgerError) {
        console.error(
          "Failed to persist summary attempt evidence",
          ledgerError,
        );
      }
    }
    attempt.recordRun("error", errorCode);
    throw error;
  }
}

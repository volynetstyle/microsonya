import type {
  AcceptedOutcomeRecord,
  MessageId,
  SummaryAction,
  SummaryAttempt,
  SummaryCommand,
  SummaryId,
  TimestampMs,
} from "@microsonya/shared";
import { randomUUID } from "node:crypto";
import type { SummaryWorkflowDependencies } from "../summary.dependencies.js";
import type { SelectedConversation } from "../window/selection.js";
import { AttemptCommitConflict } from "./AttemptCommitConflict.js";
import { defaultNow, defaultSummaryId } from "./defaults.js";
import type { SummaryErrorCode } from "./events.js";
import type { SummaryExecutionRecorder } from "./observer.js";
import {
  combineSummaryExecutionRecorders,
  startOptionalExecutionObserver,
} from "./observer.js";
import { recordAcceptedOutcome } from "./persistence.js";
import { buildAttemptRecord } from "./record.js";
import { SummaryExecutionJournal } from "./SummaryExecutionJournal.js";

interface SummaryAttemptState {
  readonly action?: SummaryAction;
  readonly messageCount: number;
  readonly contextMessageCount: number;
  readonly checkpointAdvanced: boolean;
  readonly consecutiveDeferCount: number;
  readonly checkpointBefore: MessageId | null;
  readonly selected: SelectedConversation | null;
}

type AttemptRecordingDependencies = Pick<
  SummaryWorkflowDependencies,
  "summaries" | "now" | "createSummaryId" | "executionObserver"
>;

/** Owns evidence collection and persistence for exactly one processing attempt. */
export class SummaryAttemptRecorder {
  private readonly startedAt = performance.now();
  private readonly journal = new SummaryExecutionJournal();
  private readonly startedWallClock: TimestampMs;
  readonly now: () => TimestampMs;
  readonly createSummaryId: () => SummaryId;
  readonly execution: SummaryExecutionRecorder;

  constructor(
    private readonly deps: AttemptRecordingDependencies,
    private readonly command: SummaryCommand,
    private readonly snapshot: () => SummaryAttemptState,
  ) {
    const now = deps.now ?? defaultNow;
    this.now = now;
    this.createSummaryId = deps.createSummaryId ?? defaultSummaryId;
    this.startedWallClock = now();
    const observer = startOptionalExecutionObserver(deps.executionObserver, {
      traceId: `${command.chatId}:${command.commandMessageId}:${randomUUID()}`,
      chatId: command.chatId,
      commandMessageId: command.commandMessageId,
    });
    this.execution = combineSummaryExecutionRecorders(this.journal, observer);
  }

  elapsed(): number {
    return performance.now() - this.startedAt;
  }

  async persist(
    status: SummaryAttempt["status"],
    errorCode?: SummaryErrorCode,
    acceptedOutcome?: AcceptedOutcomeRecord,
  ): Promise<void> {
    const { deps, command, now, createSummaryId, startedWallClock, journal } =
      this;
    const {
      action,
      messageCount,
      contextMessageCount,
      consecutiveDeferCount,
      checkpointBefore,
      selected,
    } = this.snapshot();
    const recordAttempt = deps.summaries.recordAttempt;
    if (recordAttempt === undefined) {
      if (acceptedOutcome !== undefined)
        await recordAcceptedOutcome(deps.summaries, acceptedOutcome);
      return;
    }

    const completedAt = now();
    const model = journal.snapshot(errorCode);
    const modelInvocations = model.modelInvocations;
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
        totalLatencyMs: this.elapsed(),
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

  recordRun(
    status: SummaryAttempt["status"],
    errorCode?: SummaryErrorCode,
  ): void {
    const { journal, execution } = this;
    const {
      action,
      messageCount,
      contextMessageCount,
      checkpointAdvanced,
      consecutiveDeferCount,
    } = this.snapshot();
    const model = journal.snapshot(errorCode);
    execution.record({
      type: "summary.run",
      action,
      messageCount,
      contextMessageCount,
      classifierMs: model.classifierMs,
      summarizerMs: model.summarizerMs,
      totalMs: this.elapsed(),
      modelCalls: model.modelCalls,
      checkpointAdvanced,
      consecutiveDeferCount,
      status,
      errorCode,
    });
  }
}

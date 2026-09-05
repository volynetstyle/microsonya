import type { OllamaClient } from "@microsonya/model";
import type {
  AcceptedOutcomeRecord,
  ChatId,
  ChatMessage,
  RecordAttemptResult,
  SummaryAttempt,
  SummaryCommand,
  SummaryId,
  TimestampMs,
  WindowDisposition,
} from "@microsonya/shared";
import type { SummaryDecisionClassifier } from "../evaluation/classify-conversation.js";
import type { ConversationSummarizer } from "../evaluation/generate-summary.js";
import type {
  FastClassifier,
  WindowProcessorDeps,
} from "../evaluation/evaluate-conversation.js";
import type { SummaryWindowSelector } from "../selection/select-conversation.js";
import type { SummarizationTelemetryService } from "./telemetry.js";

export interface MessageHistoryReader {
  listByChat(chatId: ChatId): Promise<readonly ChatMessage[]>;
}

export interface SummaryAttemptStore {
  findLatestConsumptionBoundary?(
    chatId: ChatId,
  ): Promise<Pick<AcceptedOutcomeRecord, "covers"> | undefined>;
  recordAcceptedOutcome?(outcome: AcceptedOutcomeRecord): Promise<void>;
  recordAttempt?(attempt: SummaryAttempt): Promise<RecordAttemptResult | void>;
  /** @deprecated Use findLatestConsumptionBoundary. */
  findLastRun?(
    chatId: ChatId,
  ): Promise<Pick<AcceptedOutcomeRecord, "covers"> | undefined>;
  /** @deprecated Use recordAcceptedOutcome. */
  saveRun?(outcome: AcceptedOutcomeRecord): Promise<void>;
  /** @deprecated Use recordAttempt. */
  saveAttempt?(attempt: SummaryAttempt): Promise<void>;
}

export interface SummaryWorkflow {
  process(
    command: SummaryCommand,
    signal?: AbortSignal,
  ): Promise<WindowDisposition | null>;
}

export interface SummaryWorkflowDependencies {
  readonly messages: MessageHistoryReader;
  readonly summaries: SummaryAttemptStore;
  readonly ollama?: Pick<OllamaClient, "chat">;
  readonly classifier?: SummaryDecisionClassifier;
  readonly conversationSummarizer?: ConversationSummarizer;
  readonly fastClassifier?: FastClassifier;
  readonly telemetry?: SummarizationTelemetryService;
  readonly createSummaryId?: () => SummaryId;
  readonly now?: () => TimestampMs;
  readonly windowSelector?: SummaryWindowSelector;
  readonly progressive?: WindowProcessorDeps["progressive"];
}

/** @deprecated Use MessageHistoryReader. */
export type MessageReader = MessageHistoryReader;
/** @deprecated Use SummaryWorkflow. */
export type Summarizer = SummaryWorkflow;
/** @deprecated Use SummaryWorkflowDependencies. */
export type SummarizerDeps = SummaryWorkflowDependencies;

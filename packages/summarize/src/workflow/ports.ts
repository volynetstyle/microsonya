import type { OllamaClient } from "@microsonya/model";
import type {
  AcceptedOutcomeRecord,
  ChatId,
  ChatMessage,
  RecordAttemptResult,
  SummaryAttempt,
  SummaryCommand,
  SummaryId,
  SummaryInputIdentity,
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
import type { SummaryExecutionObserver } from "./execution-journal.js";

export interface MessageHistoryReader {
  listByChat(chatId: ChatId): Promise<readonly ChatMessage[]>;
}

export interface SummaryAttemptStore {
  findLatestConsumptionBoundary(
    chatId: ChatId,
  ): Promise<Pick<AcceptedOutcomeRecord, "covers"> | undefined>;
  recordAcceptedOutcome?(outcome: AcceptedOutcomeRecord): Promise<void>;
  recordAttempt?(attempt: SummaryAttempt): Promise<RecordAttemptResult | void>;
  findReusableOutcome?(
    identity: SummaryInputIdentity,
  ): Promise<AcceptedOutcomeRecord | undefined>;
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
  readonly executionObserver?: SummaryExecutionObserver;
  readonly createSummaryId?: () => SummaryId;
  readonly now?: () => TimestampMs;
  readonly windowSelector?: SummaryWindowSelector;
  readonly progressive?: WindowProcessorDeps["progressive"];
}

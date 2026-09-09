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
import type { SummaryDecisionClassifier } from "./classifier/classifier.js";
import type { FastClassifier } from "./classifier/decision.js";
import type { SummaryExecutionObserver } from "./execution/observer.js";
import type { ConversationSummarizer } from "./generation/summarizer.js";
import type { SummaryWindowSelector } from "./window/selection.js";

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
  readonly modelGeneration?: {
    readonly currentDate?: string;
    /** Ollama Cloud supports JSON mode but not schema-constrained output. */
    readonly structuredOutput?: "schema" | "json";
  };
}

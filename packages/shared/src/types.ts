export type Brand<T, Name extends string> = T & {
  readonly __brand: Name;
};

export type ChatId = Brand<string, "ChatId">;
export type MessageId = Brand<number, "MessageId">;
export type AuthorId = Brand<string, "AuthorId">;
export type TimestampMs = Brand<number, "TimestampMs">;
export type SummaryId = Brand<string, "SummaryId">;

export function asChatId(value: unknown): ChatId {
  return asNonEmptyString(value, "ChatId") as ChatId;
}

export function asMessageId(value: unknown): MessageId {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new TypeError("MessageId must be a positive safe integer.");
  }

  return value as MessageId;
}

export function asAuthorId(value: unknown): AuthorId {
  return asNonEmptyString(value, "AuthorId") as AuthorId;
}

export function asTimestampMs(value: unknown): TimestampMs {
  if (
    !Number.isSafeInteger(value) ||
    Number.isNaN(new Date(value as number).getTime())
  ) {
    throw new TypeError(
      "TimestampMs must be a safe integer in the JavaScript Date range.",
    );
  }

  return value as TimestampMs;
}

export function asSummaryId(value: unknown): SummaryId {
  return asNonEmptyString(value, "SummaryId") as SummaryId;
}

export interface AuthorRef {
  readonly id: AuthorId;
  readonly label: string;
}

/** Canonical, source-independent text message used throughout the domain. */
export interface ChatMessage {
  readonly id: MessageId;
  readonly chatId: ChatId;
  readonly author: AuthorRef;
  readonly time: TimestampMs;
  readonly parentId: MessageId | null;
  readonly text: string;
}

export const SUMMARY_ACTIONS = [
  "SUMMARIZE",
  "DEFER_COMPACT",
  "DEFER_INCOMPLETE",
  "DEFER_CONTEXT",
  "SKIP_REACTIONS",
  "SKIP_BANTER",
  "SKIP_NO_VALUE",
] as const;

export type SummaryAction = (typeof SUMMARY_ACTIONS)[number];

/**
 * Identifier reported by deterministic classifiers.
 *
 * The shared domain intentionally does not own the concrete rule registry.
 */
export type FastRule = string;

export type DecisionEvidence =
  | {
      readonly source: "deterministic";
      readonly rule: FastRule;
    }
  | {
      readonly source: "model";
      readonly model: string;
    };

export interface SummaryDecision {
  readonly action: SummaryAction;
  readonly evidence: DecisionEvidence;
}

export interface Summary {
  readonly text: string;
}

export interface MessageRange {
  readonly firstId: MessageId;
  readonly lastId: MessageId;
  readonly count: number;
}

export interface SummaryRecord {
  readonly id: SummaryId;
  readonly chatId: ChatId;
  readonly covers: MessageRange;
  readonly text: string;
  readonly createdAt: TimestampMs;
}

export type DeferReason = Extract<SummaryAction, `DEFER_${string}`>;
export type SkipReason = Extract<SummaryAction, `SKIP_${string}`>;

export type WindowDisposition =
  | {
      readonly kind: "summarized";
      readonly summary: SummaryRecord;
    }
  | {
      readonly kind: "deferred";
      readonly reason: DeferReason;
    }
  | {
      readonly kind: "skipped";
      readonly reason: SkipReason;
    };

export type SummaryMode = "recent" | "today" | "count";

export interface SummaryCommand {
  readonly chatId: ChatId;
  readonly commandMessageId: MessageId;
  /** Telegram forum topic containing the command, when applicable. */
  readonly messageThreadId?: number;
  readonly date: TimestampMs;
  readonly mode: SummaryMode;
  readonly count?: number;
}

/** Persisted semantic result that can be recovered without model work. */
export interface AcceptedOutcomeRecord {
  readonly id: SummaryId;
  readonly chatId: ChatId;
  readonly commandMessageId: MessageId;
  readonly createdAt: TimestampMs;
  readonly covers: MessageRange;
  readonly mode: SummaryMode;
  readonly status: "summarized" | "skipped";
  readonly action: SummaryAction;
  readonly finalText: string;
}

export type SummaryAttemptStatus =
  | "summarized"
  | "deferred"
  | "skipped"
  | "empty"
  | "error";

export type SummaryAttemptMessageRole = "eligible" | "context";

/** Immutable copy of the exact message state visible to one production run. */
export interface SummaryAttemptMessageSnapshot {
  readonly ordinal: number;
  readonly chatId: ChatId;
  readonly messageId: MessageId;
  readonly role: SummaryAttemptMessageRole;
  readonly authorId: AuthorId;
  readonly authorName: string;
  readonly text: string;
  readonly sentAt: TimestampMs;
  readonly replyToId: MessageId | null;
}

export interface ModelInvocationEvidence {
  readonly id: SummaryId;
  readonly stage: "classifier" | "summarizer";
  readonly model: string;
  readonly promptHash: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly latencyMs?: number;
  readonly outputJson?: unknown;
  readonly outputText?: string;
  readonly status: "pending" | "succeeded" | "failed";
  readonly errorCode?: string;
  readonly createdAt: TimestampMs;
}

export interface DatasetCandidateEvidence {
  readonly priority: number;
  readonly reasons: readonly string[];
}

/**
 * Observed evidence for exactly one /summary attempt. It is deliberately not
 * a label: production output becomes ground truth only after human review.
 */
export interface SummaryAttempt {
  readonly id: SummaryId;
  readonly chatId: ChatId;
  readonly commandMessageId: MessageId;
  readonly startedAt: TimestampMs;
  readonly completedAt: TimestampMs;
  readonly checkpointBefore: MessageId | null;
  readonly consumedThroughMessageId: MessageId | null;
  readonly eligibleCount: number;
  readonly contextCount: number;
  readonly mode: SummaryMode;
  readonly action?: SummaryAction;
  readonly status: SummaryAttemptStatus;
  readonly classifierModel?: string;
  readonly summarizerModel?: string;
  readonly classifierPromptHash?: string;
  readonly summaryPromptHash?: string;
  readonly policyHash: string;
  readonly classifierLatencyMs: number;
  readonly summarizerLatencyMs: number;
  readonly totalLatencyMs: number;
  readonly summaryText?: string;
  readonly errorCode?: string;
  readonly inputHash: string;
  readonly messages: readonly SummaryAttemptMessageSnapshot[];
  readonly modelInvocations: readonly ModelInvocationEvidence[];
  readonly candidate?: DatasetCandidateEvidence;
}

/** Fully recoverable semantic outcome of one execution. */
export type AcceptedOutcome =
  | {
      readonly kind: "summarized";
      readonly text: string;
      readonly action: "SUMMARIZE";
    }
  | {
      readonly kind: "skipped";
      readonly reason: SkipReason;
    }
  | {
      readonly kind: "deferred";
      readonly reason: DeferReason;
    }
  | { readonly kind: "empty" };

/** The outcome belongs to the existing row when an insert is deduplicated. */
export type RecordAttemptResult =
  | { readonly status: "committed" }
  | {
      readonly status: "alreadyCommitted";
      readonly outcome: AcceptedOutcome | undefined;
    }
  | { readonly status: "ownershipLost" };

/** @deprecated Use AcceptedOutcomeRecord. */
export type SummaryRun = AcceptedOutcomeRecord;
/** @deprecated Use SummaryAttemptStatus. */
export type SummaryRunAttemptStatus = SummaryAttemptStatus;
/** @deprecated Use SummaryAttemptMessageRole. */
export type SummaryRunMessageRole = SummaryAttemptMessageRole;
/** @deprecated Use SummaryAttemptMessageSnapshot. */
export type SummaryRunMessageSnapshot = SummaryAttemptMessageSnapshot;
/** @deprecated Use SummaryAttempt. */
export type SummaryRunAttempt = SummaryAttempt;

export interface SummaryFeedback {
  readonly id: SummaryId;
  readonly runId: SummaryId;
  readonly source: "user" | "moderator" | "developer" | "automatic";
  readonly signal: "good" | "bad" | "corrected" | "rerun" | "ignored";
  readonly comment?: string;
  readonly correctedSummary?: string;
  readonly createdAt: TimestampMs;
}

function asNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value;
}

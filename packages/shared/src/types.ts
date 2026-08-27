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
  readonly date: TimestampMs;
  readonly mode: SummaryMode;
  readonly count?: number;
}

/** Persisted result of a terminal summarized or skipped workflow. */
export interface SummaryRun {
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

function asNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value;
}

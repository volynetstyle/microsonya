import { and, desc, eq, gt, inArray, or } from "drizzle-orm";
import {
  SUMMARY_ACTIONS,
  asMessageId,
  asSummaryId,
  asTimestampMs,
  type AcceptedOutcome,
  type AcceptedOutcomeRecord,
  type RecordAttemptResult,
  type ChatId,
  type DeferReason,
  type SkipReason,
  type SummaryAction,
  type SummaryMode,
  type SummaryId,
  type SummaryAttempt,
} from "@microsonya/shared";
import type { MicrosonyaDb } from "../client.js";
import type { DataEncryption } from "../encryption.js";
import {
  modelInvocations,
  summaryRunMessages,
  summaryRunLifecycle,
  summaryRuns,
} from "../schema.js";
import {
  findLatestConsumptionBoundary as readLatestConsumptionBoundary,
  type ConsumptionBoundary,
} from "./consumption-boundary.repository.js";
import { insertDatasetCandidate } from "./dataset-candidate.repository.js";
import { upsertWmaCatalogProjection } from "./wma-catalog.repository.js";

export interface OrchestrationAttemptRef {
  readonly runId: SummaryId;
  readonly attempt: number;
  readonly leaseToken: string;
  readonly acceptedAt: ReturnType<typeof asTimestampMs>;
}

export type SummaryCheckpoint = ConsumptionBoundary;

export class SummaryAttemptRepository {
  constructor(
    private readonly db: MicrosonyaDb,
    private readonly encryption: DataEncryption,
  ) {}

  async findLatestAcceptedOutcome(
    chatId: ChatId,
  ): Promise<AcceptedOutcomeRecord | undefined> {
    const row = (
      await this.db
        .select()
        .from(summaryRuns)
        .where(
          and(
            eq(summaryRuns.chatId, this.chatKey(chatId)),
            inArray(summaryRuns.status, ["summarized", "skipped"]),
          ),
        )
        .orderBy(
          desc(summaryRuns.commandMessageId),
          desc(summaryRuns.orchestrationAttempt),
          desc(summaryRuns.createdAt),
        )
        .limit(1)
    ).at(0);
    if (!row) return undefined;

    const covers = Object.freeze({
      firstId: asMessageId(row.fromMessageId),
      lastId: asMessageId(row.toMessageId),
      count: asMessageCount(row.messageCount),
    });

    return Object.freeze({
      id: asSummaryId(row.id),
      chatId,
      commandMessageId: asMessageId(row.commandMessageId),
      createdAt: asTimestampMs(row.createdAt),
      covers,
      mode: asSummaryMode(row.mode),
      status: asSummaryStatus(row.status),
      action: asSummaryAction(row.action),
      finalText: decryptRequired(
        this.encryption,
        row.summaryTextCiphertext,
        "Terminal summary text",
      ),
    });
  }

  /** Reads only checkpoint metadata; presentation ciphertext is not required. */
  async findLatestConsumptionBoundary(
    chatId: ChatId,
  ): Promise<SummaryCheckpoint | undefined> {
    return readLatestConsumptionBoundary(this.db, this.chatKey(chatId));
  }

  async findAcceptedOutcomeByExecutionId(
    executionId: SummaryId,
  ): Promise<AcceptedOutcome | undefined> {
    const row = (
      await this.db
        .select({
          id: summaryRuns.id,
          status: summaryRuns.status,
          action: summaryRuns.action,
          summaryTextCiphertext: summaryRuns.summaryTextCiphertext,
        })
        .from(summaryRuns)
        .where(
          and(
            eq(summaryRuns.orchestrationRunId, executionId),
            inArray(summaryRuns.status, [
              "summarized",
              "deferred",
              "skipped",
              "empty",
            ]),
          ),
        )
        .orderBy(desc(summaryRuns.orchestrationAttempt))
        .limit(1)
    ).at(0);
    if (row === undefined) return undefined;
    return toAcceptedOutcome(row, this.encryption);
  }

  /** Inserts the attempt and every child evidence row in one transaction. */
  async recordAttempt(
    attempt: SummaryAttempt,
    orchestration?: OrchestrationAttemptRef,
  ): Promise<RecordAttemptResult> {
    if (attempt.status === "summarized" && attempt.summaryText === undefined) {
      throw new TypeError("A summarized attempt must include summary text.");
    }
    const encryptedChatId = this.chatKey(attempt.chatId);
    const firstEligible = attempt.messages.find(
      ({ role }) => role === "eligible",
    );
    const lastEligible = findLastEligible(attempt.messages);

    return this.db.transaction(async (tx): Promise<RecordAttemptResult> => {
      if (orchestration !== undefined) {
        const accepted = await tx
          .update(summaryRunLifecycle)
          .set({ updatedAt: orchestration.acceptedAt })
          .where(
            and(
              eq(summaryRunLifecycle.id, orchestration.runId),
              eq(summaryRunLifecycle.status, "processing"),
              eq(summaryRunLifecycle.attempt, orchestration.attempt),
              eq(summaryRunLifecycle.leaseToken, orchestration.leaseToken),
              gt(summaryRunLifecycle.leaseExpiresAt, orchestration.acceptedAt),
            ),
          )
          .returning({ id: summaryRunLifecycle.id });
        if (accepted.length !== 1) return { status: "ownershipLost" };
      }
      const inserted = await tx
        .insert(summaryRuns)
        .values({
          id: attempt.id,
          orchestrationRunId: orchestration?.runId,
          orchestrationAttempt: orchestration?.attempt,
          chatId: encryptedChatId,
          commandMessageId: attempt.commandMessageId,
          fromMessageId: firstEligible?.messageId,
          toMessageId: lastEligible?.messageId,
          messageCount: attempt.eligibleCount,
          createdAt: attempt.completedAt,
          startedAt: attempt.startedAt,
          completedAt: attempt.completedAt,
          checkpointBefore: attempt.checkpointBefore,
          checkpointAfter: attempt.consumedThroughMessageId,
          eligibleCount: attempt.eligibleCount,
          contextCount: attempt.contextCount,
          mode: attempt.mode,
          status: attempt.status,
          action: attempt.action,
          classifierModel: attempt.classifierModel,
          summarizerModel: attempt.summarizerModel,
          classifierPromptHash: this.privateFingerprint(
            attempt.classifierPromptHash,
            "classifier-prompt-hash",
          ),
          summaryPromptHash: this.privateFingerprint(
            attempt.summaryPromptHash,
            "summary-prompt-hash",
          ),
          policyHash: attempt.policyHash,
          classifierLatencyMs: rounded(attempt.classifierLatencyMs),
          summarizerLatencyMs: rounded(attempt.summarizerLatencyMs),
          totalLatencyMs: rounded(attempt.totalLatencyMs),
          summaryTextCiphertext:
            attempt.summaryText === undefined
              ? null
              : this.encryption.encrypt(attempt.summaryText),
          errorCode: attempt.errorCode,
          inputHash: this.encryption.lookup(
            attempt.inputHash,
            "summary-input-hash",
          ),
        })
        .onConflictDoNothing()
        .returning({ id: summaryRuns.id });

      if (inserted.length === 0) {
        const [existing] = await tx
          .select()
          .from(summaryRuns)
          .where(
            or(
              eq(summaryRuns.id, attempt.id),
              orchestration === undefined
                ? undefined
                : and(
                    eq(summaryRuns.orchestrationRunId, orchestration.runId),
                    eq(summaryRuns.orchestrationAttempt, orchestration.attempt),
                  ),
            ),
          )
          .limit(1);
        if (existing === undefined)
          throw new Error("Conflicting attempt was not found.");
        return {
          status: "alreadyCommitted",
          outcome:
            existing.status === "error"
              ? undefined
              : toAcceptedOutcome(existing, this.encryption),
        };
      }

      if (attempt.messages.length > 0) {
        const authorKeys = new Map<string, string>();
        await tx.insert(summaryRunMessages).values(
          attempt.messages.map((message) => {
            let authorKey = authorKeys.get(message.authorId);
            if (authorKey === undefined) {
              authorKey = this.authorKey(message.authorId);
              authorKeys.set(message.authorId, authorKey);
            }
            return {
              runId: attempt.id,
              ordinal: message.ordinal,
              chatId:
                message.chatId === attempt.chatId
                  ? encryptedChatId
                  : this.chatKey(message.chatId),
              messageId: message.messageId,
              role: message.role,
              authorId: authorKey,
              authorNameCiphertext: this.encryption.encrypt(message.authorName),
              textCiphertext: this.encryption.encrypt(message.text),
              sentAt: message.sentAt,
              replyToId: message.replyToId,
            };
          }),
        );
      }

      if (attempt.modelInvocations.length > 0) {
        await tx.insert(modelInvocations).values(
          attempt.modelInvocations.map((invocation) => ({
            id: invocation.id,
            runId: attempt.id,
            stage: invocation.stage,
            model: invocation.model,
            promptHash: this.encryption.lookup(
              invocation.promptHash,
              `${invocation.stage}-prompt-hash`,
            ),
            inputTokens: invocation.inputTokens,
            outputTokens: invocation.outputTokens,
            latencyMs:
              invocation.latencyMs === undefined
                ? undefined
                : rounded(invocation.latencyMs),
            outputJson: invocation.outputJson,
            outputTextCiphertext:
              invocation.outputText === undefined
                ? null
                : this.encryption.encrypt(invocation.outputText),
            status: invocation.status,
            errorCode: invocation.errorCode,
            createdAt: invocation.createdAt,
          })),
        );
      }

      await insertDatasetCandidate(tx, attempt);

      if (attempt.status === "summarized") {
        await upsertWmaCatalogProjection(tx, {
          chatId: encryptedChatId,
          chatIdCiphertext: this.encryption.encrypt(attempt.chatId),
          messageCount: attempt.eligibleCount,
          completedAt: attempt.completedAt,
        });
      }
      return { status: "committed" };
    });
  }

  async recordAcceptedOutcome(run: AcceptedOutcomeRecord): Promise<void> {
    await this.db
      .insert(summaryRuns)
      .values({
        id: run.id,
        chatId: this.chatKey(run.chatId),
        commandMessageId: run.commandMessageId,
        fromMessageId: run.covers.firstId,
        toMessageId: run.covers.lastId,
        messageCount: run.covers.count,
        createdAt: run.createdAt,
        startedAt: run.createdAt,
        completedAt: run.createdAt,
        checkpointAfter: run.covers.lastId,
        eligibleCount: run.covers.count,
        contextCount: 0,
        mode: run.mode,
        status: run.status,
        action: run.action,
        policyHash: "legacy",
        summaryTextCiphertext: this.encryption.encrypt(run.finalText),
        inputHash: this.encryption.lookup(run.id, "legacy-summary-input"),
      })
      .onConflictDoUpdate({
        target: [summaryRuns.chatId, summaryRuns.commandMessageId],
        set: {
          id: run.id,
          createdAt: run.createdAt,
          fromMessageId: run.covers.firstId,
          toMessageId: run.covers.lastId,
          messageCount: run.covers.count,
          completedAt: run.createdAt,
          checkpointAfter: run.covers.lastId,
          eligibleCount: run.covers.count,
          mode: run.mode,
          status: run.status,
          action: run.action,
          summaryTextCiphertext: this.encryption.encrypt(run.finalText),
        },
      })
      .execute();
  }

  /** @deprecated Use findLatestAcceptedOutcome. */
  findLastRun(chatId: ChatId): Promise<AcceptedOutcomeRecord | undefined> {
    return this.findLatestAcceptedOutcome(chatId);
  }

  /** @deprecated Use findLatestConsumptionBoundary. */
  findLastCheckpoint(chatId: ChatId): Promise<SummaryCheckpoint | undefined> {
    return this.findLatestConsumptionBoundary(chatId);
  }

  /** @deprecated Use findAcceptedOutcomeByExecutionId. */
  findOrchestratedOutcome(
    executionId: SummaryId,
  ): Promise<AcceptedOutcome | undefined> {
    return this.findAcceptedOutcomeByExecutionId(executionId);
  }

  /** @deprecated Use recordAttempt. */
  async saveAttempt(
    attempt: SummaryAttempt,
    orchestration?: OrchestrationAttemptRef,
  ): Promise<void> {
    await this.recordAttempt(attempt, orchestration);
  }

  /** @deprecated Use recordAcceptedOutcome. */
  saveRun(outcome: AcceptedOutcomeRecord): Promise<void> {
    return this.recordAcceptedOutcome(outcome);
  }

  private chatKey(chatId: ChatId): string {
    return this.encryption.lookup(chatId, "telegram-chat-id");
  }

  private authorKey(authorId: string): string {
    return this.encryption.lookup(authorId, "telegram-author-id");
  }

  private privateFingerprint(
    value: string | undefined,
    namespace: string,
  ): string | undefined {
    return value === undefined
      ? undefined
      : this.encryption.lookup(value, namespace);
  }
}

/** @deprecated Use SummaryAttemptRepository. */
export { SummaryAttemptRepository as SummariesRepo };
/** @deprecated Use SummaryAttemptRepository. */
export { SummaryAttemptRepository as SummaryAttemptsRepository };

function rounded(value: number): number {
  return Math.max(0, Math.round(value));
}

function findLastEligible(
  messages: SummaryAttempt["messages"],
): SummaryAttempt["messages"][number] | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "eligible") return message;
  }
  return undefined;
}

function decryptRequired(
  encryption: DataEncryption,
  ciphertext: Buffer | null,
  label: string,
): string {
  if (ciphertext === null) {
    throw new TypeError(`${label} is missing ciphertext.`);
  }
  return encryption.decrypt(ciphertext);
}

function asMessageCount(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(
      "Summary message count must be a non-negative integer.",
    );
  }
  return value as number;
}

function asSummaryMode(value: string): SummaryMode {
  if (value === "recent" || value === "today" || value === "count") {
    return value;
  }

  throw new TypeError(`Unknown summary mode: ${value}`);
}

function asSummaryStatus(value: string): AcceptedOutcomeRecord["status"] {
  if (value === "summarized" || value === "skipped") return value;
  throw new TypeError(`Unknown summary status: ${value}`);
}

function toAcceptedOutcome(
  row: {
    readonly status: string;
    readonly action: string | null;
    readonly summaryTextCiphertext: Buffer | null;
  },
  encryption: DataEncryption,
): AcceptedOutcome {
  if (row.status === "empty") return Object.freeze({ kind: "empty" });
  const action = asSummaryAction(row.action);
  if (row.status === "summarized" && action === "SUMMARIZE") {
    return Object.freeze({
      kind: "summarized",
      action,
      text: decryptRequired(
        encryption,
        row.summaryTextCiphertext,
        "Accepted summary text",
      ),
    });
  }
  if (row.status === "skipped" && action.startsWith("SKIP_")) {
    return Object.freeze({ kind: "skipped", reason: action as SkipReason });
  }
  if (row.status === "deferred" && action.startsWith("DEFER_")) {
    return Object.freeze({ kind: "deferred", reason: action as DeferReason });
  }
  throw new TypeError(
    `Persisted attempt is not a recoverable accepted outcome: ${row.status}/${action}.`,
  );
}

function asSummaryAction(value: string | null): SummaryAction {
  if (
    value !== null &&
    (SUMMARY_ACTIONS as readonly string[]).includes(value)
  ) {
    return value as SummaryAction;
  }

  throw new TypeError(`Unknown summary action: ${value}`);
}

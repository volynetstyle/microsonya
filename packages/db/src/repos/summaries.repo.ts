import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import {
  SUMMARY_ACTIONS,
  asMessageId,
  asSummaryId,
  asTimestampMs,
  type ChatId,
  type SummaryAction,
  type SummaryMode,
  type SummaryId,
  type SummaryRun,
  type SummaryRunAttempt,
  type SummaryRunAttemptStatus,
} from "@microsonya/shared";
import type { MicrosonyaDb } from "../client.js";
import type { DataEncryption } from "../encryption.js";
import {
  datasetCandidates,
  modelInvocations,
  summaryRunMessages,
  summaryRunLifecycle,
  summaryRuns,
  wmaChatCatalog,
} from "../schema.js";

export interface PersistedSummaryAttempt {
  readonly id: SummaryId;
  readonly status: Exclude<SummaryRunAttemptStatus, "error">;
  readonly action?: SummaryAction;
  readonly summaryText?: string;
}

export interface OrchestrationAttemptRef {
  readonly runId: SummaryId;
  readonly attempt: number;
  readonly leaseToken: string;
  readonly acceptedAt: ReturnType<typeof asTimestampMs>;
}

export interface SummaryCheckpoint {
  readonly covers: SummaryRun["covers"];
}

export class SummariesRepo {
  constructor(
    private readonly db: MicrosonyaDb,
    private readonly encryption: DataEncryption,
  ) {}

  async findLastRun(chatId: ChatId): Promise<SummaryRun | undefined> {
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
  async findLastCheckpoint(
    chatId: ChatId,
  ): Promise<SummaryCheckpoint | undefined> {
    const row = (
      await this.db
        .select({
          fromMessageId: summaryRuns.fromMessageId,
          toMessageId: summaryRuns.toMessageId,
          messageCount: summaryRuns.messageCount,
        })
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
    if (row === undefined) return undefined;
    if (row.fromMessageId === null || row.toMessageId === null) {
      return undefined;
    }
    return Object.freeze({
      covers: Object.freeze({
        firstId: asMessageId(row.fromMessageId),
        lastId: asMessageId(row.toMessageId),
        count: asMessageCount(row.messageCount),
      }),
    });
  }

  async findOrchestratedOutcome(
    orchestrationRunId: SummaryId,
  ): Promise<PersistedSummaryAttempt | undefined> {
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
            eq(summaryRuns.orchestrationRunId, orchestrationRunId),
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
    return Object.freeze({
      id: asSummaryId(row.id),
      status: asCompletedAttemptStatus(row.status),
      ...(row.action === null ? {} : { action: asSummaryAction(row.action) }),
      ...(row.summaryTextCiphertext === null
        ? {}
        : { summaryText: this.encryption.decrypt(row.summaryTextCiphertext) }),
    });
  }

  /** Inserts the attempt and every child evidence row in one transaction. */
  async saveAttempt(
    attempt: SummaryRunAttempt,
    orchestration?: OrchestrationAttemptRef,
  ): Promise<void> {
    if (attempt.status === "summarized" && attempt.summaryText === undefined) {
      throw new TypeError("A summarized attempt must include summary text.");
    }
    const encryptedChatId = this.chatKey(attempt.chatId);
    const firstEligible = attempt.messages.find(
      ({ role }) => role === "eligible",
    );
    const lastEligible = findLastEligible(attempt.messages);

    await this.db.transaction(async (tx) => {
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
        if (accepted.length !== 1) return;
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
          checkpointAfter: attempt.checkpointAfter,
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
          summaryInline:
            attempt.summaryInline === undefined
              ? null
              : this.persistInline(attempt.summaryInline),
          errorCode: attempt.errorCode,
          inputHash: this.encryption.lookup(
            attempt.inputHash,
            "summary-input-hash",
          ),
        })
        .onConflictDoNothing()
        .returning({ id: summaryRuns.id });

      if (inserted.length === 0) return;

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

      if (attempt.candidate !== undefined) {
        await tx.insert(datasetCandidates).values({
          runId: attempt.id,
          priority: attempt.candidate.priority,
          reasons: [...attempt.candidate.reasons],
          status: "pending",
          createdAt: attempt.completedAt,
        });
      }

      if (attempt.status === "summarized") {
        await this.upsertWmaCatalog(
          tx,
          encryptedChatId,
          this.encryption.encrypt(attempt.chatId),
          attempt.eligibleCount,
          attempt.completedAt,
        );
      }
    });
  }

  async saveRun(run: SummaryRun): Promise<void> {
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
        summaryInline:
          run.finalInline === undefined
            ? null
            : this.persistInline(run.finalInline),
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
          summaryInline:
            run.finalInline === undefined
              ? null
              : this.persistInline(run.finalInline),
        },
      })
      .execute();
  }

  private chatKey(chatId: ChatId): string {
    return this.encryption.lookup(chatId, "telegram-chat-id");
  }

  private authorKey(authorId: string): string {
    return this.encryption.lookup(authorId, "telegram-author-id");
  }

  private persistInline(
    inline: NonNullable<SummaryRunAttempt["summaryInline"]>,
  ) {
    return inline.map((part) =>
      part.type === "text"
        ? part
        : {
            type: "participant" as const,
            participantId: this.encryption.lookup(
              part.participantId,
              "wma-participant-id",
            ),
          },
    );
  }

  private privateFingerprint(
    value: string | undefined,
    namespace: string,
  ): string | undefined {
    return value === undefined
      ? undefined
      : this.encryption.lookup(value, namespace);
  }

  private async upsertWmaCatalog(
    db: Pick<MicrosonyaDb, "insert">,
    chatId: string,
    chatIdCiphertext: Buffer,
    messageCount: number,
    completedAt: number,
  ): Promise<void> {
    await db
      .insert(wmaChatCatalog)
      .values({
        chatId,
        chatIdCiphertext,
        summaryCount: 1,
        messageCount,
        lastSummaryAt: completedAt,
        updatedAt: completedAt,
      })
      .onConflictDoUpdate({
        target: wmaChatCatalog.chatId,
        set: {
          summaryCount: sql`${wmaChatCatalog.summaryCount} + 1`,
          messageCount: sql`${wmaChatCatalog.messageCount} + ${messageCount}`,
          lastSummaryAt: sql`greatest(${wmaChatCatalog.lastSummaryAt}, ${completedAt})`,
          updatedAt: completedAt,
        },
      });
  }
}

function rounded(value: number): number {
  return Math.max(0, Math.round(value));
}

function findLastEligible(
  messages: SummaryRunAttempt["messages"],
): SummaryRunAttempt["messages"][number] | undefined {
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

function asSummaryStatus(value: string): SummaryRun["status"] {
  if (value === "summarized" || value === "skipped") return value;
  throw new TypeError(`Unknown summary status: ${value}`);
}

function asCompletedAttemptStatus(
  value: string,
): PersistedSummaryAttempt["status"] {
  if (
    value === "summarized" ||
    value === "deferred" ||
    value === "skipped" ||
    value === "empty"
  ) {
    return value;
  }
  throw new TypeError(`Unknown completed summary attempt status: ${value}`);
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

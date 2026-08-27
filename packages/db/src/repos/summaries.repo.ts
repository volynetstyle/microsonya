import { and, desc, eq, inArray } from "drizzle-orm";
import {
  SUMMARY_ACTIONS,
  asChatId,
  asMessageId,
  asSummaryId,
  asTimestampMs,
  type ChatId,
  type SummaryAction,
  type SummaryMode,
  type SummaryRun,
  type SummaryRunAttempt,
} from "@microsonya/shared";
import type { MicrosonyaDb } from "../client.js";
import type { LedgerEncryption } from "../encryption.js";
import {
  datasetCandidates,
  modelInvocations,
  summaryRunMessages,
  summaryRuns,
} from "../schema.js";

export class SummariesRepo {
  constructor(
    private readonly db: MicrosonyaDb,
    private readonly encryption: LedgerEncryption,
  ) {}

  async findLastRun(chatId: ChatId): Promise<SummaryRun | undefined> {
    const row = (
      await this.db
        .select()
        .from(summaryRuns)
        .where(
          and(
            eq(summaryRuns.chatId, chatId),
            inArray(summaryRuns.status, ["summarized", "skipped"]),
          ),
        )
        .orderBy(desc(summaryRuns.createdAt))
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
      chatId: asChatId(row.chatId),
      commandMessageId: asMessageId(row.commandMessageId),
      createdAt: asTimestampMs(row.createdAt),
      covers,
      mode: asSummaryMode(row.mode),
      status: asSummaryStatus(row.status),
      action: asSummaryAction(row.action),
      finalText:
        row.summaryTextCiphertext === null
          ? (row.text ?? "")
          : this.encryption.decrypt(row.summaryTextCiphertext),
    });
  }

  /** Inserts the attempt and every child evidence row in one transaction. */
  async saveAttempt(attempt: SummaryRunAttempt): Promise<void> {
    await this.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(summaryRuns)
        .values({
          id: attempt.id,
          chatId: attempt.chatId,
          commandMessageId: attempt.commandMessageId,
          fromMessageId: attempt.messages.find(
            ({ role }) => role === "eligible",
          )?.messageId,
          toMessageId: [...attempt.messages]
            .reverse()
            .find(({ role }) => role === "eligible")?.messageId,
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
          text: null,
          classifierModel: attempt.classifierModel,
          summarizerModel: attempt.summarizerModel,
          classifierPromptHash: attempt.classifierPromptHash,
          summaryPromptHash: attempt.summaryPromptHash,
          policyHash: attempt.policyHash,
          classifierLatencyMs: rounded(attempt.classifierLatencyMs),
          summarizerLatencyMs: rounded(attempt.summarizerLatencyMs),
          totalLatencyMs: rounded(attempt.totalLatencyMs),
          summaryTextCiphertext:
            attempt.summaryText === undefined
              ? null
              : this.encryption.encrypt(attempt.summaryText),
          errorCode: attempt.errorCode,
          inputHash: attempt.inputHash,
        })
        .onConflictDoNothing()
        .returning({ id: summaryRuns.id });

      if (inserted.length === 0) return;

      if (attempt.messages.length > 0) {
        await tx.insert(summaryRunMessages).values(
          attempt.messages.map((message) => ({
            runId: attempt.id,
            ordinal: message.ordinal,
            chatId: message.chatId,
            messageId: message.messageId,
            role: message.role,
            authorId: message.authorId,
            authorName: message.authorName,
            textCiphertext: this.encryption.encrypt(message.text),
            sentAt: message.sentAt,
            replyToId: message.replyToId,
          })),
        );
      }

      if (attempt.modelInvocations.length > 0) {
        await tx.insert(modelInvocations).values(
          attempt.modelInvocations.map((invocation) => ({
            id: invocation.id,
            runId: attempt.id,
            stage: invocation.stage,
            model: invocation.model,
            promptHash: invocation.promptHash,
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
    });
  }

  async saveRun(run: SummaryRun): Promise<void> {
    await this.db
      .insert(summaryRuns)
      .values({
        id: run.id,
        chatId: run.chatId,
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
        text: null,
        policyHash: "legacy",
        summaryTextCiphertext: this.encryption.encrypt(run.finalText),
        inputHash: "legacy",
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
          text: null,
          summaryTextCiphertext: this.encryption.encrypt(run.finalText),
        },
      })
      .execute();
  }
}

function rounded(value: number): number {
  return Math.max(0, Math.round(value));
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

function asSummaryAction(value: string | null): SummaryAction {
  if (
    value !== null &&
    (SUMMARY_ACTIONS as readonly string[]).includes(value)
  ) {
    return value as SummaryAction;
  }

  throw new TypeError(`Unknown summary action: ${value}`);
}

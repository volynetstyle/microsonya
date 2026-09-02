import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  SummaryFeedbackRepo,
  SummariesRepo,
  SummaryLifecycleRepo,
  MessagesRepo,
  createLedgerEncryption,
  datasetCandidates,
  messages as messageRows,
  modelInvocations,
  summaryFeedback,
  summaryRunMessages,
  summaryRuns,
  wmaChatCatalog,
} from "../packages/db/src/index.js";
import {
  asAuthorId,
  asChatId,
  asMessageId,
  asSummaryId,
  asTimestampMs,
  type SummaryRunAttempt,
} from "../packages/shared/src/index.js";
import { openTestDb } from "./dbTestUtils.js";

describe("production summary ledger", () => {
  it("does not accept orchestration evidence from an expired lease", async () => {
    const client = await openTestDb();
    const encryption = createLedgerEncryption(Buffer.alloc(32, 6));
    const summaries = new SummariesRepo(client.db, encryption);
    const lifecycle = new SummaryLifecycleRepo(client.db, encryption);
    const attempt = fixtureAttempt();
    try {
      const run = await lifecycle.create(
        {
          idempotencyKey: "ledger-stale-evidence",
          command: {
            chatId: attempt.chatId,
            commandMessageId: attempt.commandMessageId,
            date: attempt.completedAt,
            mode: attempt.mode,
          },
        },
        asTimestampMs(1_000),
      );
      await lifecycle.transition(
        run.id,
        "created",
        "queued",
        asTimestampMs(1_001),
      );
      const claim = await lifecycle.claimProcessing(
        run.id,
        asTimestampMs(1_002),
        10,
        "processor",
      );
      await summaries.saveAttempt(attempt, {
        runId: run.id,
        attempt: claim!.attempt,
        leaseToken: claim!.leaseToken,
        acceptedAt: asTimestampMs(1_013),
      });
      expect(await summaries.findOrchestratedOutcome(run.id)).toBeUndefined();
    } finally {
      await client.close();
    }
  });

  it("atomically stores encrypted immutable evidence and a review candidate", async () => {
    const client = await openTestDb();
    const encryption = createLedgerEncryption(Buffer.alloc(32, 7));
    const summaries = new SummariesRepo(client.db, encryption);
    const messages = new MessagesRepo(client.db, encryption);
    const feedback = new SummaryFeedbackRepo(client.db, encryption);
    const attempt = fixtureAttempt();

    try {
      await messages.save({
        id: asMessageId(11),
        chatId: attempt.chatId,
        author: { id: asAuthorId("author-b"), label: "Bob" },
        time: asTimestampMs(1_700_000_000_010),
        parentId: asMessageId(10),
        text: "Deploy at 18:00",
      });
      await summaries.saveAttempt(attempt);
      await messages.save({
        id: asMessageId(11),
        chatId: attempt.chatId,
        author: { id: asAuthorId("author-b"), label: "Bob" },
        time: asTimestampMs(1_700_000_000_010),
        parentId: asMessageId(10),
        text: "Deploy tomorrow",
      });

      const [run] = await client.db
        .select()
        .from(summaryRuns)
        .where(eq(summaryRuns.id, attempt.id));
      const snapshots = await client.db
        .select()
        .from(summaryRunMessages)
        .where(eq(summaryRunMessages.runId, attempt.id));
      const invocations = await client.db
        .select()
        .from(modelInvocations)
        .where(eq(modelInvocations.runId, attempt.id));
      const [candidate] = await client.db
        .select()
        .from(datasetCandidates)
        .where(eq(datasetCandidates.runId, attempt.id));
      const [catalog] = await client.db
        .select()
        .from(wmaChatCatalog)
        .where(eq(wmaChatCatalog.chatId, run!.chatId));

      const [canonicalMessage] = await client.db
        .select()
        .from(messageRows)
        .where(eq(messageRows.messageId, 11));
      const [roundTrippedMessage] = await messages.listByChat(attempt.chatId);

      expect(run).toMatchObject({
        status: "summarized",
        checkpointBefore: 10,
        checkpointAfter: 12,
        eligibleCount: 2,
        contextCount: 1,
        inputHash: encryption.lookup("input-sha256", "summary-input-hash"),
      });
      expect(catalog).toMatchObject({
        summaryCount: 1,
        messageCount: attempt.eligibleCount,
        lastSummaryAt: attempt.completedAt,
      });
      expect(run!.chatId).toBe(
        encryption.lookup("chat-ledger", "telegram-chat-id"),
      );
      expect(encryption.decrypt(Buffer.from(run!.summaryTextCiphertext!))).toBe(
        "Final observed summary",
      );
      expect(snapshots).toHaveLength(3);
      expect(snapshots[0]).toMatchObject({
        chatId: encryption.lookup("chat-ledger", "telegram-chat-id"),
        authorId: encryption.lookup("author-a", "telegram-author-id"),
      });
      expect(
        encryption.decrypt(Buffer.from(snapshots[0]!.authorNameCiphertext)),
      ).toBe("Alice");
      expect(
        snapshots.map((row) =>
          encryption.decrypt(Buffer.from(row.textCiphertext!)),
        ),
      ).toEqual(["Old parent", "Deploy at 18:00", "Rollback to v2"]);
      expect(invocations).toHaveLength(2);
      expect(invocations[0]!.outputJson).toMatchObject({ action: "SUMMARIZE" });
      expect(invocations[0]!.promptHash).toBe(
        encryption.lookup("classifier-sha256", "classifier-prompt-hash"),
      );
      expect(canonicalMessage).toMatchObject({
        chatId: encryption.lookup("chat-ledger", "telegram-chat-id"),
        authorId: encryption.lookup("author-b", "telegram-author-id"),
      });
      expect(
        encryption.decrypt(Buffer.from(canonicalMessage!.textCiphertext)),
      ).toBe("Deploy tomorrow");
      expect(
        encryption.decrypt(Buffer.from(canonicalMessage!.authorNameCiphertext)),
      ).toBe("Bob");
      expect(roundTrippedMessage).toMatchObject({
        chatId: "chat-ledger",
        text: "Deploy tomorrow",
        author: {
          id: encryption.lookup("author-b", "telegram-author-id"),
          label: "Bob",
        },
      });
      expect(candidate).toMatchObject({
        priority: 10,
        reasons: ["REPLY_PROVENANCE", "NUMERIC_RICH"],
        status: "pending",
      });
      const rawDatabaseEvidence = JSON.stringify({
        canonicalMessage,
        run,
        snapshots,
        invocations,
      });
      for (const privateValue of [
        "chat-ledger",
        "author-a",
        "author-b",
        "Alice",
        "Bob",
        "Deploy tomorrow",
        "Final observed summary",
      ]) {
        expect(rawDatabaseEvidence).not.toContain(privateValue);
      }

      await expect(summaries.saveAttempt(attempt)).resolves.toBeUndefined();
      const unchanged = await client.db
        .select()
        .from(summaryRunMessages)
        .where(eq(summaryRunMessages.runId, attempt.id));
      expect(unchanged).toHaveLength(3);
      expect(
        encryption.decrypt(Buffer.from(unchanged[1]!.textCiphertext!)),
      ).toBe("Deploy at 18:00");

      await feedback.save({
        id: asSummaryId("feedback-1"),
        runId: attempt.id,
        source: "user",
        signal: "corrected",
        comment: "deadline was omitted",
        correctedSummary: "Deploy at 18:00; rollback to v2.",
        createdAt: asTimestampMs(1_700_000_000_100),
      });
      const [storedFeedback] = await client.db
        .select()
        .from(summaryFeedback)
        .where(eq(summaryFeedback.runId, attempt.id));
      expect(storedFeedback).toMatchObject({
        source: "user",
        signal: "corrected",
      });
      expect(
        encryption.decrypt(Buffer.from(storedFeedback!.commentCiphertext!)),
      ).toBe("deadline was omitted");
      expect(
        encryption.decrypt(
          Buffer.from(storedFeedback!.correctedSummaryCiphertext!),
        ),
      ).toBe("Deploy at 18:00; rollback to v2.");
      expect(JSON.stringify(storedFeedback)).not.toContain(
        "deadline was omitted",
      );
      expect(JSON.stringify(storedFeedback)).not.toContain(
        "Deploy at 18:00; rollback to v2.",
      );
      const [queuedAfterFeedback] = await client.db
        .select()
        .from(datasetCandidates)
        .where(eq(datasetCandidates.runId, attempt.id));
      expect(queuedAfterFeedback?.reasons).toEqual([
        "REPLY_PROVENANCE",
        "NUMERIC_RICH",
        "USER_CORRECTION",
      ]);
      expect(queuedAfterFeedback?.priority).toBe(50);
    } finally {
      await client.close();
    }
  });

  it("records a defer without advancing the terminal checkpoint", async () => {
    const client = await openTestDb();
    const encryption = createLedgerEncryption(Buffer.alloc(32, 8));
    const summaries = new SummariesRepo(client.db, encryption);
    const terminal = fixtureAttempt();

    try {
      await summaries.saveAttempt(terminal);
      await summaries.saveAttempt({
        ...terminal,
        id: asSummaryId("run-deferred"),
        commandMessageId: asMessageId(102),
        status: "deferred",
        action: "DEFER_INCOMPLETE",
        checkpointBefore: asMessageId(12),
        checkpointAfter: asMessageId(12),
        summaryText: undefined,
        candidate: undefined,
        modelInvocations: terminal.modelInvocations.map((invocation) => ({
          ...invocation,
          id: asSummaryId(`deferred-${invocation.id}`),
        })),
      });

      const lastTerminal = await summaries.findLastRun(terminal.chatId);
      expect(lastTerminal?.id).toBe(terminal.id);
      expect(lastTerminal?.covers.lastId).toBe(12);

      const [deferred] = await client.db
        .select()
        .from(summaryRuns)
        .where(eq(summaryRuns.id, "run-deferred"));
      expect(deferred).toMatchObject({
        status: "deferred",
        checkpointBefore: 12,
        checkpointAfter: 12,
      });
    } finally {
      await client.close();
    }
  });
  it("rejects summarized evidence without summary text", async () => {
    const client = await openTestDb();
    const summaries = new SummariesRepo(
      client.db,
      createLedgerEncryption(Buffer.alloc(32, 8)),
    );
    try {
      await expect(
        summaries.saveAttempt({
          ...fixtureAttempt(),
          id: asSummaryId("run-without-summary"),
          summaryText: undefined,
        }),
      ).rejects.toThrow("must include summary text");
    } finally {
      await client.close();
    }
  });
});

function fixtureAttempt(): SummaryRunAttempt {
  const chatId = asChatId("chat-ledger");
  const createdAt = asTimestampMs(1_700_000_000_000);
  return {
    id: asSummaryId("run-success"),
    chatId,
    commandMessageId: asMessageId(101),
    startedAt: createdAt,
    completedAt: asTimestampMs(1_700_000_000_050),
    checkpointBefore: asMessageId(10),
    checkpointAfter: asMessageId(12),
    eligibleCount: 2,
    contextCount: 1,
    mode: "recent",
    action: "SUMMARIZE",
    status: "summarized",
    classifierModel: "gpt-oss:120b-cloud",
    summarizerModel: "gpt-oss:120b-cloud",
    classifierPromptHash: "classifier-sha256",
    summaryPromptHash: "summary-sha256",
    policyHash: "policy-sha256",
    classifierLatencyMs: 20,
    summarizerLatencyMs: 30,
    totalLatencyMs: 50,
    summaryText: "Final observed summary",
    inputHash: "input-sha256",
    messages: [
      {
        ordinal: 0,
        chatId,
        messageId: asMessageId(10),
        role: "context",
        authorId: asAuthorId("author-a"),
        authorName: "Alice",
        text: "Old parent",
        sentAt: asTimestampMs(1_699_999_999_000),
        replyToId: null,
      },
      {
        ordinal: 1,
        chatId,
        messageId: asMessageId(11),
        role: "eligible",
        authorId: asAuthorId("author-b"),
        authorName: "Bob",
        text: "Deploy at 18:00",
        sentAt: asTimestampMs(1_700_000_000_010),
        replyToId: asMessageId(10),
      },
      {
        ordinal: 2,
        chatId,
        messageId: asMessageId(12),
        role: "eligible",
        authorId: asAuthorId("author-a"),
        authorName: "Alice",
        text: "Rollback to v2",
        sentAt: asTimestampMs(1_700_000_000_020),
        replyToId: null,
      },
    ],
    modelInvocations: [
      {
        id: asSummaryId("invocation-classifier"),
        stage: "classifier",
        model: "gpt-oss:120b-cloud",
        promptHash: "classifier-sha256",
        inputTokens: 100,
        outputTokens: 20,
        latencyMs: 20,
        outputJson: { durable: true, action: "SUMMARIZE" },
        outputText: '{"durable":true}',
        status: "succeeded",
        createdAt,
      },
      {
        id: asSummaryId("invocation-summarizer"),
        stage: "summarizer",
        model: "gpt-oss:120b-cloud",
        promptHash: "summary-sha256",
        inputTokens: 120,
        outputTokens: 30,
        latencyMs: 30,
        outputText: '{"summary":"Final observed summary"}',
        status: "succeeded",
        createdAt,
      },
    ],
    candidate: {
      priority: 10,
      reasons: ["REPLY_PROVENANCE", "NUMERIC_RICH"],
    },
  };
}

import { acceptingReviewer, candidateFixture } from "./summaryTestFixtures.js";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  asAuthorId,
  asChatId,
  asMessageId,
  asSummaryId,
  asTimestampMs,
  type SummaryAttempt,
} from "../packages/shared/src/index.js";
import {
  combineSummaryExecutionRecorders,
  SummaryExecutionJournal,
  startOptionalExecutionObserver,
  SummarizationTelemetryService,
  createSummaryWorkflow,
} from "../packages/summarize/src/index.js";

describe("summary runtime ledger evidence", () => {
  it("produces identical evidence with no-op and full observability", () => {
    const createJournal = () =>
      new SummaryExecutionJournal(
        () => asSummaryId("invocation-1"),
        () => asTimestampMs(123),
      );
    const withoutObservability = createJournal();
    const withObservability = createJournal();
    const emitted: unknown[] = [];
    const trace = new SummarizationTelemetryService((event) =>
      emitted.push(event),
    ).start({
      traceId: "trace-1",
      chatId: asChatId("chat-1"),
      commandMessageId: asMessageId(100),
    });
    const observed = combineSummaryExecutionRecorders(withObservability, trace);
    const event = {
      type: "model.request" as const,
      stage: "classifier" as const,
      model: "test-model",
      attempt: 1,
      messageCount: 1,
      promptChars: 14,
      prompt: "private prompt",
    };

    withoutObservability.record(event);
    observed.record(event);

    expect(withObservability.snapshot()).toEqual(
      withoutObservability.snapshot(),
    );
    expect(emitted).toHaveLength(1);
  });

  it("isolates observer startup and recording failures", () => {
    const context = {
      traceId: "trace-1",
      chatId: asChatId("chat-1"),
      commandMessageId: asMessageId(100),
    };
    const failsToStart = startOptionalExecutionObserver(
      {
        start: () => {
          throw new Error("observer startup failed");
        },
      },
      context,
    );
    const failsToRecord = startOptionalExecutionObserver(
      {
        start: () => ({
          record: () => {
            throw new Error("observer recording failed");
          },
        }),
      },
      context,
    );

    expect(failsToStart).toBeUndefined();
    expect(() =>
      failsToRecord?.record({ type: "summary.start", mode: "recent" }),
    ).not.toThrow();
  });

  it("captures ledger evidence independently when event emission is disabled", () => {
    const journal = new SummaryExecutionJournal();
    const trace = new SummarizationTelemetryService(null).start({
      traceId: "production-trace",
      chatId: asChatId("chat-1"),
      commandMessageId: asMessageId(100),
    });
    const execution = combineSummaryExecutionRecorders(journal, trace);

    expect(trace.emitsEvents).toBe(false);
    execution.record({
      type: "model.request",
      stage: "classifier",
      model: "gpt-oss:120b-cloud",
      attempt: 1,
      messageCount: 1,
      promptChars: 7,
      prompt: "private",
    });
    execution.record({
      type: "model.response.envelope",
      stage: "classifier",
      model: "gpt-oss:120b-cloud",
      attempt: 1,
      durationMs: 4,
      done: true,
      contentChars: 2,
      thinkingChars: 0,
      content: "{}",
    });
    execution.record({
      type: "model.response",
      stage: "classifier",
      model: "gpt-oss:120b-cloud",
      attempt: 1,
      durationMs: 4,
      responseChars: 2,
      action: "SKIP_NO_VALUE",
    });

    const record = journal.snapshot();
    expect(record).toMatchObject({
      modelCalls: 1,
      classifierMs: 4,
    });
    expect(record.modelInvocations).toMatchObject([
      { status: "succeeded", outputText: "{}" },
    ]);
  });

  it("persists a deferred attempt without moving its checkpoint", async () => {
    const attempts: SummaryAttempt[] = [];
    const saveRun = vi.fn();
    const summarizer = createSummaryWorkflow({
      semanticReviewer: acceptingReviewer,
      messages: { listByChat: async () => [message()] },
      summaries: {
        findLatestConsumptionBoundary: async () => undefined,
        recordAcceptedOutcome: saveRun,
        recordAttempt: async (attempt) => void attempts.push(attempt),
      },
      classifier: {
        classify: async () => ({
          action: "DEFER_INCOMPLETE",
          evidence: { source: "model", model: "test-model" },
        }),
      },
      conversationSummarizer: {
        summarize: async () => {
          throw new Error("summarizer must not run");
        },
      },
    });

    await expect(summarizer.process(command())).resolves.toMatchObject({
      kind: "deferred",
      reason: "DEFER_INCOMPLETE",
    });

    expect(saveRun).not.toHaveBeenCalled();
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      status: "deferred",
      action: "DEFER_INCOMPLETE",
      checkpointBefore: null,
      consumedThroughMessageId: null,
      eligibleCount: 1,
      contextCount: 0,
      summaryText: undefined,
    });
    expect(attempts[0]!.messages[0]).toMatchObject({
      role: "eligible",
      text: "Deploy at 18:00",
    });
    expect(attempts[0]!.inputHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("persists provider failure evidence while preserving the checkpoint", async () => {
    const attempts: SummaryAttempt[] = [];
    const summarizer = createSummaryWorkflow({
      semanticReviewer: acceptingReviewer,
      messages: { listByChat: async () => [message()] },
      summaries: {
        findLatestConsumptionBoundary: async () => undefined,
        recordAcceptedOutcome: vi.fn(),
        recordAttempt: async (attempt) => void attempts.push(attempt),
      },
      classifier: {
        classify: async () => {
          throw new Error("provider unavailable");
        },
      },
      conversationSummarizer: {
        summarize: async () => candidateFixture("unused"),
      },
    });

    await expect(summarizer.process(command())).rejects.toThrow(
      "provider unavailable",
    );
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      status: "error",
      errorCode: "MODEL_PROVIDER_ERROR",
      checkpointBefore: null,
      consumedThroughMessageId: null,
    });
  });

  it("captures exact model metadata as evidence independently of log redaction", () => {
    const emitted: unknown[] = [];
    const journal = new SummaryExecutionJournal();
    const trace = new SummarizationTelemetryService(
      (event) => emitted.push(event),
      { includePrompt: false, includeModelResponse: false },
    ).start({
      traceId: "trace-1",
      chatId: asChatId("chat-1"),
      commandMessageId: asMessageId(100),
    });
    const execution = combineSummaryExecutionRecorders(journal, trace);
    const prompt = "CLASSIFICATION_POLICY\nprivate input";
    const raw = '{"durable":true}';

    execution.record({
      type: "model.request",
      stage: "classifier",
      model: "gpt-oss:120b-cloud",
      attempt: 1,
      messageCount: 1,
      promptChars: prompt.length,
      prompt,
    });
    execution.record({
      type: "model.response.envelope",
      stage: "classifier",
      model: "gpt-oss:120b-cloud",
      attempt: 1,
      durationMs: 42,
      done: true,
      promptEvalCount: 120,
      evalCount: 12,
      contentChars: raw.length,
      thinkingChars: 0,
      content: raw,
    });
    execution.record({
      type: "model.response",
      stage: "classifier",
      model: "gpt-oss:120b-cloud",
      attempt: 1,
      durationMs: 42,
      responseChars: raw.length,
      action: "SUMMARIZE",
      predicates: {
        durable: true,
        essentialReferentsResolved: true,
        visiblyIncomplete: false,
        alreadyCompact: false,
        primarilyReaction: false,
        primarilyBanter: false,
        requiresSynthesis: true,
      },
    });

    expect(journal.snapshot().modelInvocations).toEqual([
      expect.objectContaining({
        stage: "classifier",
        model: "gpt-oss:120b-cloud",
        promptHash: createHash("sha256").update(prompt).digest("hex"),
        inputTokens: 120,
        outputTokens: 12,
        latencyMs: 42,
        outputText: raw,
        status: "succeeded",
        outputJson: expect.objectContaining({ action: "SUMMARIZE" }),
      }),
    ]);
    expect(JSON.stringify(emitted)).not.toContain("private input");
    expect(JSON.stringify(emitted)).not.toContain(raw);
  });

  it("persists summary text for a non-checkpoint count run", async () => {
    const attempts: SummaryAttempt[] = [];
    const summarizer = createSummaryWorkflow({
      semanticReviewer: acceptingReviewer,
      messages: { listByChat: async () => [message()] },
      summaries: {
        findLatestConsumptionBoundary: async () => undefined,
        recordAcceptedOutcome: vi.fn(),
        recordAttempt: async (attempt) => void attempts.push(attempt),
      },
      classifier: {
        classify: async () => ({
          action: "SUMMARIZE",
          evidence: { source: "model", model: "test-model" },
        }),
      },
      conversationSummarizer: {
        summarize: async () =>
          candidateFixture("Deployment is scheduled at 18:00."),
      },
    });

    await expect(
      summarizer.process({ ...command(), mode: "count", count: 1 }),
    ).resolves.toMatchObject({ kind: "summarized" });
    expect(attempts[0]).toMatchObject({
      mode: "count",
      status: "summarized",
      summaryText: "Deployment is scheduled at 18:00.",
    });
  });
});

function command() {
  return {
    chatId: asChatId("chat-1"),
    commandMessageId: asMessageId(100),
    date: asTimestampMs(1_700_000_001_000),
    mode: "recent" as const,
  };
}

function message() {
  return {
    id: asMessageId(1),
    chatId: asChatId("chat-1"),
    author: { id: asAuthorId("author-1"), label: "Alice" },
    time: asTimestampMs(1_700_000_000_000),
    parentId: null,
    text: "Deploy at 18:00",
  };
}

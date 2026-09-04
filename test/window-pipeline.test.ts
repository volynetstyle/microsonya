import { describe, expect, it, vi } from "vitest";
import {
  SUMMARY_ACTIONS,
  asAuthorId,
  asChatId,
  asClaimId,
  asMessageId,
  asReferentId,
  asSummaryId,
  asTimestampMs,
  createConversationWindow,
  type SummaryAction,
  type SummaryDecision,
} from "../packages/shared/src/index.js";
import {
  decideWindow,
  processWindow,
  type ConversationSummarizer,
  type SummaryDecisionClassifier,
} from "../packages/summarize/src/index.js";

describe("conversation-window decision pipeline", () => {
  it.each(SUMMARY_ACTIONS)(
    "maps %s from policy decision to the factual disposition",
    async (action) => {
      const window = fixtureWindow();
      const signal = new AbortController().signal;
      const classify = vi.fn(async (receivedWindow, receivedSignal) => {
        expect(receivedWindow).toBe(window);
        expect(receivedSignal).toBe(signal);
        return modelDecision(action);
      });
      const summarize = vi.fn(async (receivedWindow, receivedSignal) => {
        expect(receivedWindow).toBe(window);
        expect(receivedSignal).toBe(signal);
        return { text: "A concise summary." };
      });

      const result = await processWindow(
        window,
        {
          classifier: { classify },
          summarizer: { summarize },
          createSummaryId: () => asSummaryId("summary-1"),
          now: () => asTimestampMs(3_000),
        },
        signal,
      );

      expect(result.decision).toEqual(modelDecision(action));
      if (action === "SUMMARIZE") {
        expect(result.disposition).toEqual({
          kind: "summarized",
          summary: {
            id: "summary-1",
            chatId: "chat",
            covers: { firstId: 5, lastId: 9, count: 2 },
            text: "A concise summary.",
            createdAt: 3_000,
          },
        });
        expect(summarize).toHaveBeenCalledOnce();
      } else if (action.startsWith("DEFER_")) {
        expect(result.disposition).toEqual({
          kind: "deferred",
          reason: action,
        });
        expect(summarize).not.toHaveBeenCalled();
      } else {
        expect(result.disposition).toEqual({
          kind: "skipped",
          reason: action,
        });
        expect(summarize).not.toHaveBeenCalled();
      }
    },
  );

  it("lets a resolved fast rule bypass the semantic classifier", async () => {
    const window = fixtureWindow();
    const classify = vi.fn<SummaryDecisionClassifier["classify"]>();
    const summarize = vi.fn<ConversationSummarizer["summarize"]>();

    const result = await processWindow(window, {
      classifier: { classify },
      summarizer: { summarize },
      fastClassifier: {
        classify: (receivedWindow, analysis) => {
          expect(receivedWindow).toBe(window);
          expect(analysis.hasExternalReply).toBe(false);
          return {
            kind: "resolved",
            action: "DEFER_COMPACT",
            rule: "TEST_ALREADY_COMPACT",
          };
        },
      },
    });

    expect(result).toEqual({
      decision: {
        action: "DEFER_COMPACT",
        evidence: {
          source: "deterministic",
          rule: "TEST_ALREADY_COMPACT",
        },
      },
      disposition: { kind: "deferred", reason: "DEFER_COMPACT" },
    });
    expect(classify).not.toHaveBeenCalled();
    expect(summarize).not.toHaveBeenCalled();
  });

  it("does not infer DEFER_CONTEXT merely from an external parent", async () => {
    const window = fixtureWindow(true);
    const classify = vi.fn(async () => modelDecision("DEFER_COMPACT"));

    await expect(decideWindow(window, { classify })).resolves.toEqual(
      modelDecision("DEFER_COMPACT"),
    );
    expect(classify).toHaveBeenCalledOnce();
  });

  it("vetoes only a risky irreversible skip and never promotes it to summarize", async () => {
    const window = fixtureWindow(true);
    const summarize = vi.fn<ConversationSummarizer["summarize"]>();
    const result = await processWindow(window, {
      classifier: { classify: async () => modelDecision("SKIP_NO_VALUE") },
      summarizer: { summarize },
    });

    expect(result).toEqual({
      decision: {
        action: "DEFER_COMPACT",
        evidence: { source: "model", model: "test-model" },
      },
      disposition: { kind: "deferred", reason: "DEFER_COMPACT" },
    });
    expect(summarize).not.toHaveBeenCalled();
  });

  it("uses the streaming summarizer when a production-progressive sink is provided", async () => {
    const summarize = vi.fn<ConversationSummarizer["summarize"]>();
    const stream = vi.fn(async function* () {
      yield "Production ";
      yield "summary.";
    });
    const append = vi.fn();
    const result = await processWindow(fixtureWindow(), {
      classifier: { classify: async () => modelDecision("SUMMARIZE") },
      summarizer: { summarize, stream },
      progressive: {
        begin: vi.fn(async () => undefined),
        append,
        finalize: vi.fn(async () => "Production summary."),
        fail: vi.fn(async () => undefined),
      },
    });

    expect(stream).toHaveBeenCalledOnce();
    expect(summarize).not.toHaveBeenCalled();
    expect(append.mock.calls).toEqual([["Production "], ["summary."]]);
    expect(result.disposition).toMatchObject({
      kind: "summarized",
      summary: { text: "Production summary." },
    });
  });

  it("begins progressive output only after plan extraction and validation", async () => {
    const window = fixtureWindow();
    let resolvePlan!: (value: ReturnType<typeof plan>) => void;
    const pendingPlan = new Promise<ReturnType<typeof plan>>(
      (resolve) => (resolvePlan = resolve),
    );
    const begin = vi.fn(async () => undefined);
    const streamPlan = vi.fn(async function* (receivedPlan) {
      expect(receivedPlan).toEqual(plan());
      yield "Validated summary.";
    });

    const pending = processWindow(window, {
      classifier: { classify: async () => modelDecision("SUMMARIZE") },
      summarizer: {
        summarize: vi.fn(),
        prepare: vi.fn(async () => pendingPlan),
        streamPlan,
      },
      progressive: {
        begin,
        append: vi.fn(),
        finalize: vi.fn(async () => "Validated summary."),
        fail: vi.fn(async () => undefined),
      },
    });

    await Promise.resolve();
    expect(begin).not.toHaveBeenCalled();
    expect(streamPlan).not.toHaveBeenCalled();
    resolvePlan(plan());
    await expect(pending).resolves.toMatchObject({
      disposition: {
        kind: "summarized",
        summary: { text: "Validated summary." },
      },
    });
    expect(begin).toHaveBeenCalledOnce();
    expect(streamPlan).toHaveBeenCalledOnce();
  });

  it("honors an already-aborted signal before either model-facing component", async () => {
    const controller = new AbortController();
    controller.abort();
    const classify = vi.fn<SummaryDecisionClassifier["classify"]>();
    const summarize = vi.fn<ConversationSummarizer["summarize"]>();

    await expect(
      processWindow(
        fixtureWindow(),
        { classifier: { classify }, summarizer: { summarize } },
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(classify).not.toHaveBeenCalled();
    expect(summarize).not.toHaveBeenCalled();
  });
});

function fixtureWindow(externalReply = false) {
  return createConversationWindow([
    {
      id: asMessageId(5),
      chatId: asChatId("chat"),
      author: { id: asAuthorId("a"), label: "Vlad" },
      time: asTimestampMs(1_000),
      parentId: null,
      text: "First",
    },
    {
      id: asMessageId(9),
      chatId: asChatId("chat"),
      author: { id: asAuthorId("b"), label: "Vlad" },
      time: asTimestampMs(2_000),
      parentId: externalReply ? asMessageId(2) : null,
      text: "Second",
    },
  ]);
}

function modelDecision(action: SummaryAction): SummaryDecision {
  return {
    action,
    evidence: { source: "model", model: "test-model" },
  };
}

function plan() {
  return {
    referents: [{ id: asReferentId("r1"), kind: "task" as const }],
    claims: [
      {
        id: asClaimId("c1"),
        referentId: asReferentId("r1"),
        proposition: "The task is complete.",
        epistemicStatus: "established" as const,
        evidenceMessageIds: [asMessageId(5)],
      },
    ],
    retainedClaimIds: [asClaimId("c1")],
  };
}

import { describe, expect, it, vi } from "vitest";
import {
  SUMMARY_ACTIONS,
  asAuthorId,
  asChatId,
  asMessageId,
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
          expect(analysis.hasExternalReply).toBe(true);
          return {
            kind: "resolved",
            action: "SKIP_REACTIONS",
            rule: "TEST_REACTIONS_ONLY",
          };
        },
      },
    });

    expect(result).toEqual({
      decision: {
        action: "SKIP_REACTIONS",
        evidence: {
          source: "deterministic",
          rule: "TEST_REACTIONS_ONLY",
        },
      },
      disposition: { kind: "skipped", reason: "SKIP_REACTIONS" },
    });
    expect(classify).not.toHaveBeenCalled();
    expect(summarize).not.toHaveBeenCalled();
  });

  it("does not infer DEFER_CONTEXT merely from an external parent", async () => {
    const window = fixtureWindow();
    const classify = vi.fn(async () => modelDecision("DEFER_COMPACT"));

    await expect(decideWindow(window, { classify })).resolves.toEqual(
      modelDecision("DEFER_COMPACT"),
    );
    expect(classify).toHaveBeenCalledOnce();
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

function fixtureWindow() {
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
      parentId: asMessageId(2),
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

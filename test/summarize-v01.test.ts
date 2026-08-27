import { describe, expect, it, vi } from "vitest";
import {
  asAuthorId,
  asChatId,
  asMessageId,
  asSummaryId,
  asTimestampMs,
  type ChatMessage,
  type SummaryCommand,
  type SummaryRun,
} from "../packages/shared/src/index.js";
import {
  createSummarizer,
  SummarizationTelemetryService,
  type SummarizationTelemetryEvent,
} from "../packages/summarize/src/index.js";

describe("summarizer 0.1 workflow", () => {
  it("classifies and summarizes one selected W, then persists exact provenance", async () => {
    const saveRun = vi.fn(async () => undefined);
    const events: SummarizationTelemetryEvent[] = [];
    const listByChat = vi.fn(async () => [message(1, "Release is Friday")]);
    const chat = vi.fn(
      async (request: { options?: { num_predict?: number } }) => {
        if (request.options?.num_predict === 512) {
          return {
            message: {
              content: JSON.stringify({
                durable: true,
                essentialReferentsResolved: true,
                visiblyIncomplete: false,
                alreadyCompact: false,
                primarilyReaction: false,
                primarilyBanter: false,
                requiresSynthesis: true,
              }),
            },
          };
        }
        return {
          message: {
            content: JSON.stringify({ summary: "Release is Friday." }),
          },
        };
      },
    );
    const summarizer = createSummarizer({
      messages: { listByChat },
      summaries: { findLastRun: async () => undefined, saveRun },
      ollama: { chat: chat as never },
      telemetry: new SummarizationTelemetryService(
        (event) => events.push(event),
        { includePrompt: false },
      ),
    });

    await expect(summarizer.process(command())).resolves.toMatchObject({
      kind: "summarized",
      summary: { text: "Release is Friday." },
    });
    expect(listByChat).toHaveBeenCalledOnce();
    expect(chat).toHaveBeenCalledTimes(2);
    expect(events.map((event) => event.type)).toEqual([
      "summary.start",
      "messages.loaded",
      "messages.selected",
      "window.analyzed",
      "window.fast-classifier",
      "model.request",
      "model.response.envelope",
      "model.response.raw",
      "model.response",
      "window.decision",
      "model.request",
      "model.response.envelope",
      "model.response.raw",
      "model.response",
      "window.disposition",
      "summary.saved",
      "summary.finish",
      "summary.run",
    ]);
    expect(events.at(-1)).toMatchObject({
      type: "summary.run",
      action: "SUMMARIZE",
      messageCount: 1,
      contextMessageCount: 0,
      modelCalls: 2,
      checkpointAdvanced: true,
      consecutiveDeferCount: 0,
      status: "summarized",
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "model.response",
        stage: "classifier",
        action: "SUMMARIZE",
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "window.analyzed",
        analysis: expect.objectContaining({ turnCount: 1 }),
      }),
    );
    expect(chat.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        model: "gpt-oss:120b-cloud",
        think: "low",
        format: "json",
        stream: false,
        options: expect.objectContaining({ num_predict: 512 }),
      }),
    );
    expect(chat.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        model: "gpt-oss:120b-cloud",
        think: "low",
        format: "json",
        stream: false,
        options: expect.objectContaining({ num_predict: 2_500 }),
      }),
    );
    expect(saveRun).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat",
        commandMessageId: 10,
        covers: { firstId: 1, lastId: 1, count: 1 },
        status: "summarized",
        action: "SUMMARIZE",
        finalText: "Release is Friday.",
      }),
    );
  });

  it("persists a skipped boundary so low-value messages are not reconsidered", async () => {
    const saveRun = vi.fn(async () => undefined);
    const summarizer = createSummarizer({
      messages: { listByChat: async () => [message(5, "👍")] },
      summaries: { findLastRun: async () => undefined, saveRun },
      classifier: {
        classify: async () => ({
          action: "SKIP_REACTIONS",
          evidence: { source: "model", model: "test" },
        }),
      },
      conversationSummarizer: {
        summarize: vi.fn(async () => ({ text: "must not run" })),
      },
    });

    await expect(summarizer.process(command())).resolves.toEqual({
      kind: "skipped",
      reason: "SKIP_REACTIONS",
    });
    expect(saveRun).toHaveBeenCalledWith(
      expect.objectContaining({
        covers: { firstId: 5, lastId: 5, count: 1 },
        status: "skipped",
        action: "SKIP_REACTIONS",
      }),
    );
  });

  it("does not persist a deferred window so it remains eligible later", async () => {
    const saveRun = vi.fn(async () => undefined);
    const summarizer = createSummarizer({
      messages: { listByChat: async () => [message(5, "Checking now")] },
      summaries: { findLastRun: async () => undefined, saveRun },
      classifier: {
        classify: async () => ({
          action: "DEFER_INCOMPLETE",
          evidence: { source: "model", model: "test" },
        }),
      },
      conversationSummarizer: {
        summarize: vi.fn(async () => ({ text: "must not run" })),
      },
    });

    await expect(summarizer.process(command())).resolves.toEqual({
      kind: "deferred",
      reason: "DEFER_INCOMPLETE",
    });
    expect(saveRun).not.toHaveBeenCalled();
  });

  it("reports a consecutive defer streak for the same persisted checkpoint", async () => {
    const events: SummarizationTelemetryEvent[] = [];
    const summarizer = createSummarizer({
      messages: { listByChat: async () => [message(5, "Checking now")] },
      summaries: { findLastRun: async () => undefined, saveRun: vi.fn() },
      classifier: {
        classify: async () => ({
          action: "DEFER_COMPACT",
          evidence: { source: "model", model: "test" },
        }),
      },
      conversationSummarizer: { summarize: vi.fn() },
      telemetry: new SummarizationTelemetryService((event) =>
        events.push(event),
      ),
    });

    await summarizer.process(command());
    await summarizer.process(command());

    expect(
      events
        .filter((event) => event.type === "summary.run")
        .map((event) => event.consecutiveDeferCount),
    ).toEqual([1, 2]);
  });

  it("uses an old reply parent as model context but persists coverage for eligible content only", async () => {
    const saveRun = vi.fn(async () => undefined);
    const previous = previousRun(1);
    const summarizer = createSummarizer({
      messages: {
        listByChat: async () => [
          message(1, "Deploy is blocked by migration 42"),
          message(2, "Migration is complete; deploy can start", 1),
        ],
      },
      summaries: { findLastRun: async () => previous, saveRun },
      classifier: {
        classify: async (window) => {
          expect(window.messages.map(({ id }) => id)).toEqual([1, 2]);
          return {
            action: "SUMMARIZE",
            evidence: { source: "model", model: "test" },
          };
        },
      },
      conversationSummarizer: {
        summarize: async () => ({
          text: "Migration complete; deploy unblocked.",
        }),
      },
      createSummaryId: () => asSummaryId("reply-summary"),
      now: () => asTimestampMs(200_000_001),
    });

    await expect(summarizer.process(command())).resolves.toMatchObject({
      kind: "summarized",
      summary: { covers: { firstId: 2, lastId: 2, count: 1 } },
    });
    expect(saveRun).toHaveBeenCalledWith(
      expect.objectContaining({
        covers: { firstId: 2, lastId: 2, count: 1 },
      }),
    );
  });

  it("does not advance the persisted checkpoint when saving the terminal run fails", async () => {
    const events: SummarizationTelemetryEvent[] = [];
    const previous = previousRun(1);
    const saveFailure = new Error("database unavailable");
    const summarizer = createSummarizer({
      messages: {
        listByChat: async () => [message(1, "old"), message(2, "new")],
      },
      summaries: {
        findLastRun: async () => previous,
        saveRun: async () => Promise.reject(saveFailure),
      },
      classifier: {
        classify: async () => ({
          action: "SKIP_NO_VALUE",
          evidence: { source: "model", model: "test" },
        }),
      },
      conversationSummarizer: { summarize: vi.fn() },
      telemetry: new SummarizationTelemetryService((event) =>
        events.push(event),
      ),
    });

    await expect(summarizer.process(command())).rejects.toBe(saveFailure);
    expect(
      events.find((event) => event.type === "summary.error"),
    ).toMatchObject({
      type: "summary.error",
      error: { code: "STORAGE_ERROR" },
    });
    expect(events.at(-1)).toMatchObject({
      type: "summary.run",
      checkpointAdvanced: false,
      status: "error",
      errorCode: "STORAGE_ERROR",
    });
  });

  it("returns null without calling either model when selection is empty", async () => {
    const chat = vi.fn();
    const summarizer = createSummarizer({
      messages: { listByChat: async () => [] },
      summaries: {
        findLastRun: async () => undefined,
        saveRun: vi.fn(),
      },
      ollama: { chat: chat as never },
    });

    await expect(summarizer.process(command())).resolves.toBeNull();
    expect(chat).not.toHaveBeenCalled();
  });

  it("attributes an invalid classifier contract to classifier.output", async () => {
    const events: SummarizationTelemetryEvent[] = [];
    const saveRun = vi.fn();
    const summarizer = createSummarizer({
      messages: { listByChat: async () => [message(1, "Release is Friday")] },
      summaries: {
        findLastRun: async () => undefined,
        saveRun,
      },
      ollama: {
        chat: (async () => ({ message: { content: "" } })) as never,
      },
      telemetry: new SummarizationTelemetryService(
        (event) => events.push(event),
        { includeModelResponse: false },
      ),
    });

    await expect(summarizer.process(command())).rejects.toMatchObject({
      code: "MODEL_OUTPUT_EMPTY",
    });
    const errorEvent = events.find((event) => event.type === "summary.error");
    expect(errorEvent).toMatchObject({
      type: "summary.error",
      stage: "classifier.output",
      error: {
        name: "ModelOutputError",
        code: "MODEL_OUTPUT_EMPTY",
        detailCode: "MODEL_OUTPUT_EMPTY",
        outputChars: 0,
      },
    });
    expect(errorEvent).not.toHaveProperty("error.outputPreview");
    expect(events.at(-1)).toMatchObject({
      type: "summary.run",
      status: "error",
      errorCode: "MODEL_OUTPUT_EMPTY",
    });
    expect(saveRun).not.toHaveBeenCalled();
  });

  it("preserves the Ollama client receiver for both model calls", async () => {
    const ollama = {
      callCount: 0,
      async chat(request: { options?: { num_predict?: number } }) {
        expect(this).toBe(ollama);
        this.callCount += 1;
        return {
          message: {
            content:
              request.options?.num_predict === 512
                ? JSON.stringify({
                    durable: true,
                    essentialReferentsResolved: true,
                    visiblyIncomplete: false,
                    alreadyCompact: false,
                    primarilyReaction: false,
                    primarilyBanter: false,
                    requiresSynthesis: true,
                  })
                : JSON.stringify({ summary: "Release is Friday." }),
          },
        };
      },
    };
    const summarizer = createSummarizer({
      messages: { listByChat: async () => [message(1, "Release is Friday")] },
      summaries: {
        findLastRun: async () => undefined,
        saveRun: vi.fn(async () => undefined),
      },
      ollama: ollama as never,
    });

    await expect(summarizer.process(command())).resolves.toMatchObject({
      kind: "summarized",
    });
    expect(ollama.callCount).toBe(2);
  });
});

function command(): SummaryCommand {
  return {
    chatId: asChatId("chat"),
    commandMessageId: asMessageId(10),
    date: asTimestampMs(200_000_000),
    mode: "recent",
  };
}

function message(
  id: number,
  text: string,
  parentId: number | null = null,
): ChatMessage {
  return {
    id: asMessageId(id),
    chatId: asChatId("chat"),
    author: { id: asAuthorId("1"), label: "Olia" },
    time: asTimestampMs(199_999_000 + id),
    parentId: parentId === null ? null : asMessageId(parentId),
    text,
  };
}

function previousRun(lastId: number): SummaryRun {
  return {
    id: asSummaryId("previous"),
    chatId: asChatId("chat"),
    commandMessageId: asMessageId(8),
    createdAt: asTimestampMs(199_000_000),
    covers: {
      firstId: asMessageId(1),
      lastId: asMessageId(lastId),
      count: lastId,
    },
    mode: "recent",
    status: "summarized",
    action: "SUMMARIZE",
    finalText: "previous",
  };
}

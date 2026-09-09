import { describe, expect, it, vi } from "vitest";
import {
  asAuthorId,
  asChatId,
  asMessageId,
  asSummaryId,
  asTimestampMs,
  type AcceptedOutcomeRecord,
  type SummaryAttempt,
  type SummaryCommand,
} from "../packages/shared/src/index.js";
import { createSummaryWorkflow } from "../packages/summarize/src/index.js";

describe("semantic summary cache", () => {
  it("reuses only the resolved snapshot and still advances catch-up", async () => {
    const attempts: SummaryAttempt[] = [];
    const model = vi.fn(async () => {
      throw new Error("model must not run on an exact cache hit");
    });
    const findReusableOutcome = vi.fn(async () => cachedOutcome());
    const workflow = createSummaryWorkflow({
      messages: { listByChat: async () => [message()] },
      summaries: {
        findLatestConsumptionBoundary: async () => undefined,
        findReusableOutcome,
        recordAttempt: async (attempt) => void attempts.push(attempt),
      },
      ollama: { chat: model as never },
      createSummaryId: () => asSummaryId("reused-attempt"),
      now: () => asTimestampMs(200_000_100),
    });

    await expect(workflow.process(command("recent"))).resolves.toMatchObject({
      kind: "summarized",
      summary: { text: "cached text" },
    });
    expect(model).not.toHaveBeenCalled();
    expect(findReusableOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: asChatId("chat"),
        start: asMessageId(1),
        end: asMessageId(10),
        eligibleCount: 1,
        inputHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        policyHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(attempts[0]).toMatchObject({
      status: "summarized",
      checkpointBefore: null,
      consumedThroughMessageId: 1,
      summaryText: "cached text",
    });
  });

  it("does not advance a historical query on the same cache hit", async () => {
    const attempts: SummaryAttempt[] = [];
    const workflow = createSummaryWorkflow({
      messages: { listByChat: async () => [message()] },
      summaries: {
        findLatestConsumptionBoundary: async () => ({
          covers: { firstId: asMessageId(2), lastId: asMessageId(5), count: 4 },
        }),
        findReusableOutcome: async () => cachedOutcome(),
        recordAttempt: async (attempt) => void attempts.push(attempt),
      },
      ollama: { chat: vi.fn() as never },
      createSummaryId: () => asSummaryId("historical-attempt"),
      now: () => asTimestampMs(200_000_100),
    });

    await workflow.process(command("today"));
    expect(attempts[0]).toMatchObject({
      checkpointBefore: 5,
      consumedThroughMessageId: 5,
    });
  });
});

function command(mode: SummaryCommand["mode"]): SummaryCommand {
  return {
    chatId: asChatId("chat"),
    commandMessageId: asMessageId(10),
    date: asTimestampMs(200_000_000),
    mode,
  };
}

function message() {
  return {
    id: asMessageId(1),
    chatId: asChatId("chat"),
    author: { id: asAuthorId("author"), label: "Olia" },
    time: asTimestampMs(199_999_999),
    parentId: null,
    text: "release Friday",
  };
}

function cachedOutcome(): AcceptedOutcomeRecord {
  return {
    id: asSummaryId("cached"),
    chatId: asChatId("chat"),
    commandMessageId: asMessageId(10),
    createdAt: asTimestampMs(200_000_000),
    covers: { firstId: asMessageId(1), lastId: asMessageId(1), count: 1 },
    mode: "recent",
    status: "summarized",
    action: "SUMMARIZE",
    finalText: "cached text",
  };
}

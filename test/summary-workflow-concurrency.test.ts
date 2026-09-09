import { acceptingReviewer } from "./summaryTestFixtures.js";
import { describe, expect, it } from "vitest";
import {
  asAuthorId,
  asChatId,
  asMessageId,
  asSummaryId,
  asTimestampMs,
  type SummaryAttempt,
  type SummaryCommand,
} from "../packages/shared/src/index.js";
import { createSummaryWorkflow } from "../packages/summarize/src/index.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("summary workflow concurrency", () => {
  it("isolates attempt evidence across chats and releases a failed chat's queued command", async () => {
    const entered = deferred<void>();
    const release = deferred<void>();
    const firstChat = asChatId("first");
    const otherChat = asChatId("other");
    const now = asTimestampMs(Date.UTC(2026, 8, 8, 12));
    const classifierCalls: string[] = [];
    const attempts: SummaryAttempt[] = [];
    let id = 0;
    const workflow = createSummaryWorkflow({
      semanticReviewer: acceptingReviewer,
      now: () => now,
      createSummaryId: () => asSummaryId(`attempt-${++id}`),
      messages: {
        async listByChat(chatId) {
          return [
            {
              id: asMessageId(10),
              chatId,
              author: { id: asAuthorId(chatId), label: chatId },
              time: asTimestampMs(now - 1_000),
              parentId: null,
              text: `history for ${chatId}`,
            },
          ];
        },
      },
      summaries: {
        async findLatestConsumptionBoundary() {
          return undefined;
        },
        async recordAttempt(attempt) {
          attempts.push(attempt);
        },
      },
      classifier: {
        async classify(window) {
          classifierCalls.push(window.chatId);
          if (classifierCalls.length === 1) {
            entered.resolve();
            await release.promise;
          }
          return {
            action: "SKIP_REACTIONS",
            evidence: { source: "deterministic", rule: "fixture" },
          };
        },
      },
      conversationSummarizer: {
        async summarize() {
          throw new Error("Skipped windows must not generate text.");
        },
      },
    });
    const command = (
      chatId: SummaryCommand["chatId"],
      messageId: number,
    ): SummaryCommand => ({
      chatId,
      commandMessageId: asMessageId(messageId),
      date: now,
      mode: "recent",
    });

    const first = workflow.process(command(firstChat, 100));
    const failed = expect(first).rejects.toThrow("first classifier failed");
    await entered.promise;
    const queued = workflow.process(command(firstChat, 101));
    await expect(
      workflow.process(command(otherChat, 200)),
    ).resolves.toMatchObject({ kind: "skipped" });
    expect(classifierCalls).toEqual([firstChat, otherChat]);
    expect(attempts.map(({ chatId }) => chatId)).toEqual([otherChat]);

    release.reject(new Error("first classifier failed"));
    await failed;
    await expect(queued).resolves.toMatchObject({ kind: "skipped" });

    expect(classifierCalls).toEqual([firstChat, otherChat, firstChat]);
    expect(
      attempts.map(
        ({ chatId, commandMessageId, status, consumedThroughMessageId }) => ({
          chatId,
          commandMessageId,
          status,
          consumedThroughMessageId,
        }),
      ),
    ).toEqual([
      {
        chatId: otherChat,
        commandMessageId: 200,
        status: "skipped",
        consumedThroughMessageId: 10,
      },
      {
        chatId: firstChat,
        commandMessageId: 100,
        status: "error",
        consumedThroughMessageId: null,
      },
      {
        chatId: firstChat,
        commandMessageId: 101,
        status: "skipped",
        consumedThroughMessageId: 10,
      },
    ]);
    for (const attempt of attempts) {
      expect(attempt.messages.map(({ text }) => text)).toEqual([
        `history for ${attempt.chatId}`,
      ]);
    }
    expect(new Set(attempts.map(({ id }) => id)).size).toBe(3);
  });
});

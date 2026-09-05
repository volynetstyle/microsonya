import { describe, expect, it } from "vitest";
import {
  asAuthorId,
  asChatId,
  asMessageId,
  asTimestampMs,
  type ChatMessage,
  type SummaryCommand,
} from "../packages/shared/src/index.js";
import {
  pendingSummaryWindowSelector,
  selectConversationWindow,
  selectMessages,
} from "../packages/summarize/src/index.js";
import { MAX_MESSAGES } from "../packages/summarize/src/evaluation/policy.js";
import { buildModelPrompt } from "../packages/summarize/src/evaluation/model-prompt.js";

const command: SummaryCommand = {
  chatId: asChatId("chat"),
  commandMessageId: asMessageId(10),
  date: asTimestampMs(Date.UTC(2026, 0, 2, 12)),
  mode: "recent",
};

function message(
  id: number,
  overrides: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    id: asMessageId(id),
    chatId: asChatId("chat"),
    author: { id: asAuthorId("author"), label: "Author" },
    time: asTimestampMs(command.date - 1_000),
    parentId: null,
    text: `message ${id}`,
    ...overrides,
  };
}

describe("summary conversation-window selection", () => {
  it("includes only non-empty messages strictly after the cursor and omits the trigger", () => {
    expect(
      selectMessages(
        [
          message(4),
          message(5),
          message(7, { text: "  " }),
          message(9),
          message(10, { text: "/summarize" }),
        ],
        command,
        asMessageId(4),
      ).map((item) => item.id),
    ).toEqual([5, 9]);
  });

  it("applies the time boundary and command upper boundary", () => {
    const window = selectConversationWindow(
      [
        message(7, {
          time: asTimestampMs(command.date - 86_400_001),
        }),
        message(8, {
          time: asTimestampMs(command.date - 86_400_000),
        }),
        message(9, { time: asTimestampMs(command.date + 1) }),
        message(11, { time: asTimestampMs(command.date - 1_000) }),
      ],
      command,
    );

    expect(window?.window.messages.map((item) => item.id)).toEqual([8, 9]);
    expect(window?.messages.map(({ role }) => role)).toEqual([
      "eligible",
      "eligible",
    ]);
    expect(Object.isFrozen(window)).toBe(true);
    expect(Object.isFrozen(window?.messages)).toBe(true);
  });

  it("is deterministic when a retry observes messages added after its command", () => {
    const beforeRetry = pendingSummaryWindowSelector.select({
      messages: [message(7), message(8), message(9)],
      command,
    })!;
    const retry = pendingSummaryWindowSelector.select({
      messages: [message(7), message(8), message(9), message(11), message(12)],
      command,
    })!;

    expect(retry.eligibleMessages.map(({ id }) => id)).toEqual(
      beforeRetry.eligibleMessages.map(({ id }) => id),
    );
  });

  it("marks a parent behind the cursor as context rather than eligible content", () => {
    const selected = selectConversationWindow(
      [
        message(4, { text: "old parent" }),
        message(9, { parentId: asMessageId(4), text: "new reply" }),
      ],
      command,
      asMessageId(4),
    )!;

    expect(
      selected.messages.map(({ message, role }) => ({ id: message.id, role })),
    ).toEqual([
      { id: 4, role: "context" },
      { id: 9, role: "eligible" },
    ]);
    expect(selected.eligibleMessages.map(({ id }) => id)).toEqual([9]);
    expect(selected.contextMessages.map(({ id }) => id)).toEqual([4]);
  });

  it("lets the ConversationWindow factory reject a mixed-chat repository result", () => {
    expect(() =>
      selectConversationWindow(
        [message(1), message(2, { chatId: asChatId("wrong-chat") })],
        { ...command, commandMessageId: asMessageId(99) },
      ),
    ).toThrow(/different chat/i);
  });

  it("takes the earliest contiguous canonical chunk instead of skipping to a tail", () => {
    const messages = Array.from({ length: MAX_MESSAGES + 2 }, (_, index) =>
      message(101 + index, { time: asTimestampMs(command.date - 1_000) }),
    );
    const selected = pendingSummaryWindowSelector.select({
      messages,
      command: { ...command, commandMessageId: asMessageId(10_000) },
      checkpointBefore: asMessageId(100),
    })!;

    expect(selected.consumption).toBe("checkpoint");
    expect(selected.eligibleMessages).toHaveLength(MAX_MESSAGES);
    expect(selected.eligibleMessages[0]?.id).toBe(101);
    expect(selected.consumptionUpperBound).toBe(100 + MAX_MESSAGES);
  });

  it("treats an explicit count as a read-only history selection", () => {
    const selected = pendingSummaryWindowSelector.select({
      messages: [message(101), message(102), message(103), message(104)],
      command: {
        ...command,
        commandMessageId: asMessageId(105),
        mode: "count",
        count: 2,
      },
      checkpointBefore: asMessageId(100),
    })!;

    expect(selected.eligibleMessages.map(({ id }) => id)).toEqual([103, 104]);
    expect(selected.consumption).toBe("read-only");
    expect(selected.consumptionUpperBound).toBe(100);
  });

  it("marks reply parents as context-only in model input", () => {
    const selected = selectConversationWindow(
      [
        message(4, { text: "parent" }),
        message(9, { parentId: asMessageId(4), text: "reply" }),
      ],
      command,
      asMessageId(4),
    )!;
    const prompt = buildModelPrompt(
      "SUMMARY_POLICY",
      "policy",
      selected.window,
      selected.messages,
    );

    expect(prompt).toContain("INPUT_ROLES_BEGIN\n#4|context\n#9|eligible");
    expect(prompt).toContain(
      "Do not treat context-only messages as new events",
    );
  });
});

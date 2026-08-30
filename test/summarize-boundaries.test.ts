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
  selectConversationWindow,
  selectMessages,
} from "../packages/summarize/src/index.js";

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

  it("applies the time boundary and returns one validated canonical window", () => {
    const window = selectConversationWindow(
      [
        message(11, {
          time: asTimestampMs(command.date - 86_400_001),
        }),
        message(12, {
          time: asTimestampMs(command.date - 86_400_000),
        }),
        message(13, { time: asTimestampMs(command.date + 1) }),
      ],
      command,
    );

    expect(window?.window.messages.map((item) => item.id)).toEqual([12, 13]);
    expect(window?.messages.map(({ role }) => role)).toEqual([
      "eligible",
      "eligible",
    ]);
    expect(Object.isFrozen(window)).toBe(true);
    expect(Object.isFrozen(window?.messages)).toBe(true);
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
});

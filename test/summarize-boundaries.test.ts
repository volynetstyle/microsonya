import { describe, expect, it } from "vitest";
import type {
  ChatMessage,
  SummaryCommand,
} from "../packages/shared/src/index.js";
import { selectMessages } from "../packages/summarize/src/index.js";

const command: SummaryCommand = {
  chatId: "chat",
  commandMessageId: 10,
  date: Date.UTC(2026, 0, 2, 12),
  mode: "recent",
};

function message(
  id: number,
  overrides: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    id,
    chatId: "chat",
    date: command.date - 1_000,
    authorId: "author",
    authorName: "Author",
    text: `message ${id}`,
    kind: "text",
    ...overrides,
  };
}

describe("summary message-window invariants", () => {
  it("includes only non-command, non-empty text messages strictly after the cursor", () => {
    expect(
      selectMessages(
        [
          message(4),
          message(5),
          message(6, { isCommand: true }),
          message(7, { text: "  " }),
          message(8, { kind: "photo" }),
          message(9),
          message(10, { isCommand: true, text: "/summarize" }),
        ],
        command,
        4,
      ).map((item) => item.id),
    ).toEqual([5, 9]);
  });

  it("applies the time boundary after cursor and eligibility filtering", () => {
    const recent = selectMessages(
      [
        message(11, { date: command.date - 86_400_001 }),
        message(12, { date: command.date - 86_400_000 }),
        message(13, { date: command.date + 1 }),
      ],
      command,
    );

    expect(recent.map((item) => item.id)).toEqual([12, 13]);
  });
});

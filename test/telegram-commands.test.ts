import { describe, expect, it } from "vitest";
import {
  parseSummaryArgs,
  parseSummaryCommand,
  parseSummaryCommandUpdate,
  SUMMARY_COMMAND_NAME,
  telegramCommands,
  parseTelegramChatMessageUpdate,
} from "../packages/telegram/src/index.js";

describe("Telegram summary command", () => {
  it("parses a targeted command directly into the application request", () => {
    expect(
      parseSummaryCommand(
        {
          message_id: 5,
          date: 1_700,
          text: "/summary@MicrosonyaBot today",
          chat: { id: 42 },
          from: { id: 7, first_name: "Alice" },
          entities: [{ type: "bot_command", offset: 0, length: 22 }],
        },
        "microsonyaBot",
      ),
    ).toEqual({
      chatId: "42",
      commandMessageId: 5,
      date: 1_700_000,
      mode: "today",
    });
  });

  it("keeps slash-prefixed control input out of semantic evidence", () => {
    const message = {
      message_id: 5,
      date: 1_700,
      text: "/summary today",
      chat: { id: 42 },
      entities: [],
    };

    expect(parseSummaryCommand(message)).toBeUndefined();
    expect(parseTelegramChatMessageUpdate({ message })?.text).toBeUndefined();
  });

  it("ignores commands addressed to another bot", () => {
    expect(
      parseSummaryCommand(
        {
          message_id: 5,
          date: 1_700,
          text: "/summary@other_bot",
          chat: { id: 42 },
          entities: [{ type: "bot_command", offset: 0, length: 18 }],
        },
        "microsonya_bot",
      ),
    ).toBeUndefined();
  });

  it("uses one command name for registration and recognition", () => {
    expect(SUMMARY_COMMAND_NAME).toBe("summary");
    expect(telegramCommands[0]?.command).toBe(SUMMARY_COMMAND_NAME);
  });
});

describe("summary command arguments", () => {
  it.each([
    { raw: "", expected: { mode: "recent" } },
    { raw: "today", expected: { mode: "today" } },
    { raw: "20", expected: { mode: "count", count: 20 } },
  ])("parses '$raw'", ({ raw, expected }) => {
    expect(parseSummaryArgs(raw)).toEqual(expected);
  });

  it.each(["0", "129", "hello", "today extra"])("rejects '%s'", (raw) => {
    expect(parseSummaryArgs(raw)).toBeUndefined();
  });
});

describe("untrusted Telegram update boundary", () => {
  it("projects a valid update directly into a domain command", () => {
    expect(
      parseSummaryCommandUpdate(
        {
          update_id: 42,
          message: {
            message_id: 5,
            date: 1_700,
            text: "/summary 20",
            chat: { id: 42 },
            entities: [{ type: "bot_command", offset: 0, length: 8 }],
          },
        },
        "microsonya_bot",
      ),
    ).toEqual({
      chatId: "42",
      commandMessageId: 5,
      date: 1_700_000,
      mode: "count",
      count: 20,
    });
  });

  it.each([
    undefined,
    { update_id: 1 },
    { update_id: 1, message: { text: "/summary" } },
    {
      update_id: 1,
      message: {
        message_id: 1,
        date: 1,
        text: "/summary",
        chat: {},
        entities: [{ type: "bot_command", offset: "0", length: 8 }],
      },
    },
  ])("rejects malformed input %#", (input) => {
    expect(parseSummaryCommandUpdate(input, "microsonya_bot")).toBeUndefined();
  });
});

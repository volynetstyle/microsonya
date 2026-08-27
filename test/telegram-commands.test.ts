import { describe, expect, it } from "vitest";
import {
  parseSummaryArgs,
  parseSummaryCommand,
  SUMMARY_COMMAND_NAME,
  telegramCommands,
} from "../apps/telegram/bot/src/command.js";
import { fromTelegram } from "../apps/telegram/bot/src/telegram/message.js";

describe("Telegram summary command", () => {
  it("parses a targeted command directly into the application request", () => {
    expect(
      parseSummaryCommand(
        {
          message_id: 5,
          date: 1_700,
          text: "/summarize@MicrosonyaBot today",
          chat: { id: 42 },
          from: { id: 7, first_name: "Alice" },
          entities: [{ type: "bot_command", offset: 0, length: 24 }],
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

  it("does not infer control input from slash-prefixed ordinary text", () => {
    const message = {
      message_id: 5,
      date: 1_700,
      text: "/summarize today",
      chat: { id: 42 },
      entities: [],
    };

    expect(parseSummaryCommand(message)).toBeUndefined();
    expect(fromTelegram(message)?.text).toBe("/summarize today");
  });

  it("ignores commands addressed to another bot", () => {
    expect(
      parseSummaryCommand(
        {
          message_id: 5,
          date: 1_700,
          text: "/summarize@other_bot",
          chat: { id: 42 },
          entities: [{ type: "bot_command", offset: 0, length: 20 }],
        },
        "microsonya_bot",
      ),
    ).toBeUndefined();
  });

  it("uses one command name for registration and recognition", () => {
    expect(SUMMARY_COMMAND_NAME).toBe("summarize");
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

  it.each(["0", "1025", "hello", "today extra"])("rejects '%s'", (raw) => {
    expect(parseSummaryArgs(raw)).toBeUndefined();
  });
});

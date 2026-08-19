import { describe, expect, it } from "vitest";
import { toCommandInvocation } from "../apps/telegram/bot/src/commands/telegram.js";
import { parseSummarizeArgs } from "../apps/telegram/bot/src/commands/summarize.js";
import { toChatMessage } from "../apps/telegram/bot/src/telegram/message.js";

describe("Telegram command extraction", () => {
  it("uses a leading bot_command entity and preserves the remaining arguments", () => {
    const invocation = toCommandInvocation(
      {
        message_id: 5,
        date: 1_700,
        text: "/summarize@MicrosonyaBot today",
        chat: { id: 42 },
        from: { id: 7, first_name: "Alice" },
        message_thread_id: 9,
        entities: [{ type: "bot_command", offset: 0, length: 24 }],
      },
      "microsonyaBot",
    );

    expect(invocation).toMatchObject({
      chatId: "42",
      messageId: 5,
      date: 1_700_000,
      name: "summarize",
      args: ["today"],
    });
  });

  it("does not infer commands from slash-prefixed text", () => {
    const message = {
      message_id: 5,
      date: 1_700,
      text: "/summarize today",
      chat: { id: 42 },
      entities: [],
    };

    expect(toCommandInvocation(message)).toBeUndefined();
    expect(toChatMessage(message).isCommand).toBe(false);
  });

  it("ignores commands explicitly addressed to another bot", () => {
    expect(
      toCommandInvocation(
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
});

describe("summarize arguments", () => {
  it.each([
    [[], { mode: "recent" }],
    [["today"], { mode: "today" }],
    [["20"], { mode: "count", count: 20 }],
  ])("parses %j", (args, expected) => {
    expect(parseSummarizeArgs(args)).toEqual(expected);
  });

  it.each([["0"], ["1025"], ["hello"], ["today", "extra"]])(
    "rejects %j",
    (args) => {
      expect(parseSummarizeArgs(args)).toBeUndefined();
    },
  );
});

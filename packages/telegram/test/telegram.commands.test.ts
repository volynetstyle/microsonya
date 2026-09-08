import { describe, expect, it } from "vitest";
import {
  APP_COMMAND_NAME,
  createAppLauncherMessage,
  parseAppCommandUpdate,
  parseSummaryArgs,
  parseSummaryCommandUpdate,
  SUMMARY_COMMAND_NAME,
  TELEGRAM_COMMAND_SETS,
  parseTelegramChatMessageUpdate,
} from "../src";

describe("Telegram app command", () => {
  it("registers /app as an ephemeral command", () => {
    expect(APP_COMMAND_NAME).toBe("app");
    expect(TELEGRAM_COMMAND_SETS).toContainEqual({
      scope: { type: "all_group_chats" },
      commands: [
        {
          command: APP_COMMAND_NAME,
          description: "Відкрити Microsonya",
          is_ephemeral: true,
        },
        {
          command: SUMMARY_COMMAND_NAME,
          description: "Створити підсумок",
        },
      ],
    });
  });

  it("parses an ephemeral group command and creates a private launcher", () => {
    const command = parseAppCommandUpdate(
      {
        update_id: 42,
        message: {
          message_id: 0,
          ephemeral_message_id: 91,
          date: 1_700,
          text: "/app@MicrosonyaBot",
          chat: { id: -42, type: "supergroup" },
          from: { id: 7, first_name: "Alice" },
          entities: [{ type: "bot_command", offset: 0, length: 18 }],
        },
      },
      "microsonyabot",
    );

    expect(command).toEqual({
      chatId: "-42",
      userId: 7,
      chatType: "supergroup",
      ephemeralMessageId: 91,
    });
    expect(createAppLauncherMessage(command!, "MicrosonyaBot")).toEqual({
      chat_id: "-42",
      text: "Microsonya готова до роботи.",
      ephemeral_message_parameters: { receiver_user_id: 7 },
      reply_parameters: { ephemeral_message_id: 91 },
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "Відкрити Microsonya",
              url: "https://t.me/MicrosonyaBot?startapp",
            },
          ],
        ],
      },
    });
  });

  it("fails closed for a public group /app command", () => {
    expect(
      parseAppCommandUpdate(
        {
          update_id: 42,
          message: {
            message_id: 7,
            date: 1_700,
            text: "/app",
            chat: { id: -42, type: "group" },
            from: { id: 7 },
            entities: [{ type: "bot_command", offset: 0, length: 4 }],
          },
        },
        "MicrosonyaBot",
      ),
    ).toBeUndefined();
  });

  it("supports /app targeted at a username with an underscore", () => {
    expect(
      parseAppCommandUpdate(
        {
          update_id: 43,
          message: {
            message_id: 0,
            ephemeral_message_id: 92,
            date: 1_700,
            text: "/app@microsonya_bot",
            chat: { id: -42, type: "supergroup" },
            from: { id: 7 },
            entities: [{ type: "bot_command", offset: 0, length: 19 }],
          },
        },
        "microsonya_bot",
      ),
    ).toMatchObject({
      chatId: "-42",
      userId: 7,
      ephemeralMessageId: 92,
    });
  });

  it("normalizes a configured username with a leading at-sign", () => {
    expect(
      parseAppCommandUpdate(
        {
          update_id: 44,
          message: {
            message_id: 0,
            ephemeral_message_id: 93,
            date: 1_700,
            text: "/app@MicrosonyaBot",
            chat: { id: -42, type: "supergroup" },
            from: { id: 7 },
            entities: [{ type: "bot_command", offset: 0, length: 18 }],
          },
        },
        "@microsonyabot",
      ),
    ).toBeDefined();
  });

  it("ignores malformed unrelated entities while decoding the command", () => {
    expect(
      parseAppCommandUpdate({
        update_id: 45,
        message: {
          message_id: 7,
          date: 1_700,
          text: "/app",
          chat: { id: 7, type: "private" },
          from: { id: 7 },
          entities: [
            { type: "bold", offset: "invalid", length: null },
            { type: "bot_command", offset: 0, length: 4 },
          ],
        },
      }),
    ).toBeDefined();
  });

  it("keeps /app usable in a private chat", () => {
    const command = parseAppCommandUpdate({
      update_id: 42,
      message: {
        message_id: 7,
        date: 1_700,
        text: "/app",
        chat: { id: 7, type: "private" },
        from: { id: 7 },
        entities: [{ type: "bot_command", offset: 0, length: 4 }],
      },
    });

    expect(createAppLauncherMessage(command!, "@MicrosonyaBot")).toMatchObject({
      chat_id: "7",
      reply_markup: {
        inline_keyboard: [[{ url: "https://t.me/MicrosonyaBot?startapp" }]],
      },
    });
    expect(
      createAppLauncherMessage(command!, "MicrosonyaBot"),
    ).not.toHaveProperty("ephemeral_message_parameters");
  });
});

describe("Telegram summary command", () => {
  it("parses a targeted command directly into the application request", () => {
    expect(
      parseSummaryCommandUpdate(
        {
          update_id: 1,
          message: {
            message_id: 5,
            date: 1_700,
            text: "/summary@MicrosonyaBot today",
            chat: { id: 42, type: "private" },
            from: { id: 7, first_name: "Alice" },
            entities: [{ type: "bot_command", offset: 0, length: 22 }],
          },
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
      chat: { id: 42, type: "private" },
      entities: [],
    };

    expect(
      parseSummaryCommandUpdate({ update_id: 1, message }),
    ).toBeUndefined();
    expect(
      parseTelegramChatMessageUpdate({ update_id: 1, message })?.text,
    ).toBeUndefined();
  });

  it("ignores commands addressed to another bot", () => {
    expect(
      parseSummaryCommandUpdate(
        {
          update_id: 1,
          message: {
            message_id: 5,
            date: 1_700,
            text: "/summary@other_bot",
            chat: { id: 42, type: "private" },
            entities: [{ type: "bot_command", offset: 0, length: 18 }],
          },
        },
        "microsonya_bot",
      ),
    ).toBeUndefined();
  });

  it("uses one command name for registration and recognition", () => {
    expect(SUMMARY_COMMAND_NAME).toBe("summary");
    expect(
      TELEGRAM_COMMAND_SETS.every(({ commands }) =>
        commands.some(({ command }) => command === SUMMARY_COMMAND_NAME),
      ),
    ).toBe(true);
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
            message_thread_id: 77,
            date: 1_700,
            text: "/summary 20",
            chat: { id: 42, type: "private" },
            entities: [{ type: "bot_command", offset: 0, length: 8 }],
          },
        },
        "microsonya_bot",
      ),
    ).toEqual({
      chatId: "42",
      commandMessageId: 5,
      messageThreadId: 77,
      date: 1_700_000,
      mode: "count",
      count: 20,
    });
  });

  it.each([
    { text: "/summary", expected: { mode: "recent" } },
    { text: "/summary today", expected: { mode: "today" } },
    { text: "/summary 20", expected: { mode: "count", count: 20 } },
  ])("preserves the forum topic for '$text'", ({ text, expected }) => {
    expect(
      parseSummaryCommandUpdate(
        {
          update_id: 42,
          message: {
            message_id: 5,
            message_thread_id: 77,
            date: 1_700,
            text,
            chat: { id: -10042, type: "supergroup" },
            entities: [{ type: "bot_command", offset: 0, length: 8 }],
          },
        },
        "microsonya_bot",
      ),
    ).toEqual({
      chatId: "-10042",
      commandMessageId: 5,
      messageThreadId: 77,
      date: 1_700_000,
      ...expected,
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

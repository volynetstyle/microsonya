import {
  asChatId,
  asMessageId,
  asTimestampMs,
  type SummaryCommand,
} from "@microsonya/shared";
import {
  isForwardedMessage,
  type TelegramMessageLike,
} from "./telegram/message.js";

export const SUMMARY_COMMAND_NAME = "summary";
const MAX_REQUESTED_COUNT = 1024;

export const telegramCommands = [
  {
    command: SUMMARY_COMMAND_NAME,
    description: "Summarize recent messages",
  },
];

export function parseSummaryCommand(
  message: TelegramMessageLike,
  botUsername?: string,
): SummaryCommand | undefined {
  if (isForwardedMessage(message) || !message.text) return undefined;

  const entity = message.entities?.find(
    ({ type, offset }) => type === "bot_command" && offset === 0,
  );

  if (!entity) return undefined;

  // Telegram entity offsets are UTF-16 code units,
  // matching JavaScript String#slice.
  const command = parseBotCommand(
    message.text.slice(entity.offset, entity.offset + entity.length),
  );

  if (!command) return undefined;

  if (command.name.toLowerCase() !== SUMMARY_COMMAND_NAME) {
    return undefined;
  }

  if (
    command.target !== undefined &&
    (botUsername === undefined ||
      command.target.toLowerCase() !== botUsername.toLowerCase())
  ) {
    return undefined;
  }

  const args = parseSummaryArgs(
    message.text.slice(entity.offset + entity.length).trim(),
  );

  if (!args) return undefined;

  return {
    chatId: asChatId(String(message.chat.id)),
    commandMessageId: asMessageId(message.message_id),
    date: asTimestampMs(message.date * 1_000),
    ...args,
  };
}

function parseBotCommand(
  raw: string,
): { name: string; target?: string } | undefined {
  const match = /^\/([a-z0-9_]+)(?:@([a-z0-9_]+))?$/iu.exec(raw);
  if (!match) return undefined;

  const [, name, target] = match;
  if (!name) return undefined;

  return { name, target };
}

export function parseSummaryArgs(
  raw: string,
): Pick<SummaryCommand, "mode" | "count"> | undefined {
  switch (raw) {
    case "":
      return { mode: "recent" };

    case "today":
      return { mode: "today" };
  }

  if (!/^\d+$/u.test(raw)) return undefined;

  const count = Number(raw);

  if (
    !Number.isSafeInteger(count) ||
    count < 1 ||
    count > MAX_REQUESTED_COUNT
  ) {
    return undefined;
  }

  return { mode: "count", count };
}

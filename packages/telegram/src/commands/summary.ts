import {
  asChatId,
  asMessageId,
  asTimestampMs,
  type SummaryCommand,
} from "@microsonya/shared";
import { parseTelegramCommand } from "../telegram.command.js";
import { SUMMARY_COMMAND } from "../telegram.commands.js";
import { parseTelegramMessageUpdate } from "../telegram.message.js";

const MAX_REQUESTED_COUNT = 128;

export function parseSummaryCommandUpdate(
  input: unknown,
  botUsername?: string,
): SummaryCommand | undefined {
  const message = parseTelegramMessageUpdate(input);
  if (message === undefined) return undefined;
  const command = parseTelegramCommand(message, botUsername);
  if (command === undefined || command.name !== SUMMARY_COMMAND.command) {
    return undefined;
  }
  const args = parseSummaryArgs(command.args);
  if (args === undefined || message.messageId <= 0) return undefined;
  return {
    chatId: asChatId(message.chatId),
    commandMessageId: asMessageId(message.messageId),
    ...(message.messageThreadId === undefined
      ? {}
      : { messageThreadId: message.messageThreadId }),
    date: asTimestampMs(message.dateMs),
    ...args,
  };
}

export function parseSummaryArgs(
  raw: string,
): Pick<SummaryCommand, "mode" | "count"> | undefined {
  if (raw === "") return { mode: "recent" };
  if (raw === "today") return { mode: "today" };
  if (!/^\d+$/u.test(raw)) return undefined;
  const count = Number(raw);
  return Number.isSafeInteger(count) &&
    count >= 1 &&
    count <= MAX_REQUESTED_COUNT
    ? { mode: "count", count }
    : undefined;
}

import type { SummaryCommand } from "@microsonya/shared";
import type { TelegramCommandInvocation } from "./telegram.js";

const COMMAND_NAME = "summarize";
const MAX_REQUESTED_COUNT = 1024;

export type SummarizeArgs =
  | { mode: "recent" }
  | { mode: "today" }
  | { mode: "count"; count: number };

export function parseSummarizeArgs(
  args: readonly string[],
): SummarizeArgs | undefined {
  if (args.length > 1) {
    return undefined;
  }

  const argument = args[0];

  if (argument === undefined) {
    return { mode: "recent" };
  }

  if (argument === "today") {
    return { mode: "today" };
  }

  const count = parseCountArgument(argument);

  if (count !== undefined) {
    return { mode: "count", count };
  }

  return undefined;
}

export const telegramCommands = [
  {
    command: COMMAND_NAME,
    description: "Summarize recent messages",
  },
];

export function toSummaryCommand(
  invocation: TelegramCommandInvocation,
  args: SummarizeArgs,
): SummaryCommand {
  return {
    chatId: invocation.chatId,
    commandMessageId: invocation.messageId,
    date: invocation.date,
    ...args,
  };
}

function parseCountArgument(argument: string): number | undefined {
  if (!/^\d+$/.test(argument)) {
    return undefined;
  }

  const count = Number(argument);

  if (!Number.isSafeInteger(count)) {
    return undefined;
  }

  if (count < 1 || count > MAX_REQUESTED_COUNT) {
    return undefined;
  }

  return count;
}

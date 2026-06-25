import type { SummaryCommand } from "@microsonya/shared";

const COMMAND_NAME = "summarize";
const MAX_REQUESTED_COUNT = 1024;

export function parseSummaryCommand(
  chatId: string,
  commandMessageId: number,
  date: number,
  text: string,
): SummaryCommand | undefined {
  const tokens = text.trim().split(/\s+/);

  const rawCommand = tokens[0];
  const argument = tokens[1];

  if (!rawCommand || !isSummaryCommand(rawCommand)) {
    return undefined;
  }

  if (tokens.length > 2) {
    return undefined;
  }

  if (argument === undefined) {
    return {
      chatId,
      commandMessageId,
      date,
      mode: "recent",
    };
  }

  if (argument === "today") {
    return {
      chatId,
      commandMessageId,
      date,
      mode: "today",
    };
  }

  const count = parseCountArgument(argument);

  if (count !== undefined) {
    return {
      chatId,
      commandMessageId,
      date,
      mode: "count",
      count,
    };
  }

  return undefined;
}

function isSummaryCommand(command: string): boolean {
  const [name] = command.split("@", 2);

  return name === `/${COMMAND_NAME}`;
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

import type { SummaryCommand } from "@microsonya/shared";

export function parseSummaryCommand(chatId: string, commandMessageId: number, date: number, text: string): SummaryCommand | undefined {
  const [command, argument] = text.trim().split(/\s+/, 2);

  if (command !== "/summarize") {
    return undefined;
  }

  if (argument === "today") {
    return { chatId, commandMessageId, date, mode: "today" };
  }

  if (argument && /^\d+$/.test(argument)) {
    return { chatId, commandMessageId, date, mode: "count", count: Number(argument) };
  }

  return { chatId, commandMessageId, date, mode: "recent" };
}

import type { ChatMessage, SummaryCommand, SummaryRun } from "@microsonya/shared";

export const MAX_MESSAGES = 1024
export const MAX_HOURS = 24;

export function selectSummaryWindow(
  command: SummaryCommand,
  messages: ChatMessage[],
  lastSummary?: SummaryRun
): ChatMessage[] {
  const chatMessages = messages
    .filter((message) => message.chatId === command.chatId && message.kind === "text" && message.text.trim() !== "")
    .sort((a, b) => a.id - b.id);

  if (command.mode === "count") {
    return chatMessages.slice(-clampCount(command.count ?? 100));
  }

  const minDate = command.mode === "today" ? startOfLocalDay(command.date) : command.date - MAX_HOURS * 60 * 60 * 1000;
  const minMessageId = command.mode === "recent" ? lastSummary?.toMessageId : undefined;

  return chatMessages
    .filter((message) => message.date >= minDate)
    .filter((message) => minMessageId === undefined || message.id > minMessageId)
    .slice(-MAX_MESSAGES);
}

function clampCount(count: number): number {
  return Math.max(1, Math.min(MAX_MESSAGES, Math.floor(count)));
}

function startOfLocalDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

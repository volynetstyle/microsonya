import type {
  ChatMessage,
  SummaryCommand,
  SummaryRun,
} from "@microsonya/shared";

export const MAX_MESSAGES = 1024;
export const DEFAULT_COUNT = 100;
export const MAX_HOURS = 24;

const HOUR_MS = 60 * 60 * 1000;

export function selectSummaryWindow(
  command: SummaryCommand,
  messages: ChatMessage[],
  lastSummary?: SummaryRun,
): ChatMessage[] {
  const chatMessages = messages
    .filter(isSummarizableMessage(command.chatId))
    .sort((a, b) => a.id - b.id);

  switch (command.mode) {
    case "count": {
      return chatMessages.slice(-clampCount(command.count ?? DEFAULT_COUNT));
    }

    case "today": {
      const minDate = startOfLocalDay(command.date);

      return chatMessages
        .filter((message) => message.date >= minDate)
        .slice(-MAX_MESSAGES);
    }

    case "recent": {
      return selectRecentWindow(command, chatMessages, lastSummary);
    }
  }
}

function selectRecentWindow(
  command: SummaryCommand,
  messages: ChatMessage[],
  lastSummary?: SummaryRun,
): ChatMessage[] {
  if (lastSummary?.chatId === command.chatId) {
    return messages
      .filter((message) => message.id > lastSummary.toMessageId)
      .slice(-MAX_MESSAGES);
  }

  const minDate = command.date - MAX_HOURS * HOUR_MS;

  return messages
    .filter((message) => message.date >= minDate)
    .slice(-MAX_MESSAGES);
}

function isSummarizableMessage(chatId: string) {
  return (message: ChatMessage): boolean =>
    message.chatId === chatId &&
    message.kind === "text" &&
    message.text.trim() !== "";
}

function clampCount(count: number): number {
  return Math.max(1, Math.min(MAX_MESSAGES, Math.floor(count)));
}

function startOfLocalDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

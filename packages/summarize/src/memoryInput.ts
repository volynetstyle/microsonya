import type { ChatMessage, MemoryItem, MemoryState } from "@microsonya/shared";
import type { NormalizedMemoryMessage } from "./memoryPrompt.js";

export const DEFAULT_MAX_RELEVANT_MEMORY = 50;

export function normalizeMessages(
  state: MemoryState,
  messages: readonly ChatMessage[],
): NormalizedMemoryMessage[] {
  const byId = new Map<number, ChatMessage>();
  const watermark = state.processedThroughMessageId ?? -1;

  for (const message of messages) {
    if (message.chatId !== state.chatId || message.id <= watermark) continue;
    byId.set(message.id, message);
  }

  const ordered = [...byId.values()].sort((left, right) => left.id - right.id);
  const authorAliases = new Map<string, string>();

  return ordered.map((message, index) => {
    let authorAlias = authorAliases.get(message.authorId);
    if (!authorAlias) {
      authorAlias = `participant_${authorAliases.size + 1}`;
      authorAliases.set(message.authorId, authorAlias);
    }

    return {
      ...message,
      date: Number.isFinite(message.date) ? Math.trunc(message.date) : 0,
      authorName: message.authorName.trim(),
      text: normalizeMemoryText(message.text),
      replyToId:
        message.replyToId !== undefined && message.replyToId > 0
          ? Math.trunc(message.replyToId)
          : undefined,
      order: index + 1,
      authorAlias,
    };
  });
}

export function retrieveRelevantMemory(
  state: MemoryState,
  messages: readonly NormalizedMemoryMessage[],
  maxItems = DEFAULT_MAX_RELEVANT_MEMORY,
): MemoryItem[] {
  if (maxItems <= 0) return [];

  const queryTokens = new Set(
    messages.flatMap((message) => tokenize(message.text)),
  );

  return state.items
    .filter((item) => item.status === "active")
    .map((item) => ({
      item,
      score:
        tokenize(item.text).filter((token) => queryTokens.has(token)).length *
          10 +
        (item.kind === "open_question" ? 4 : 0) +
        Math.min(item.lastUpdatedMessageId / 1_000_000, 1),
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.item.lastUpdatedMessageId - left.item.lastUpdatedMessageId ||
        left.item.id.localeCompare(right.item.id),
    )
    .slice(0, maxItems)
    .map(({ item }) => item);
}

export function normalizeMemoryText(text: string): string {
  return text.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function tokenize(text: string): string[] {
  return (
    normalizeMemoryText(text)
      .toLocaleLowerCase("en-US")
      .match(/[\p{L}\p{N}_-]{3,}/gu) ?? []
  );
}

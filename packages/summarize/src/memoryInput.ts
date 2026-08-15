import type { ChatMessage, MemoryItem, MemoryState } from "@microsonya/shared";
import type { NormalizedMemoryMessage } from "./memoryPrompt.js";
import { tokenizeMemoryText, type MemoryTable } from "./memoryTable.js";

export const DEFAULT_MAX_RELEVANT_MEMORY = 50;

export function normalizeMessages(
  state: MemoryState,
  messages: readonly ChatMessage[],
): NormalizedMemoryMessage[] {
  const watermark = state.processedThroughMessageId ?? -1;

  const ordered = [
    ...new Map(
      messages
        .filter(
          (message) =>
            message.chatId === state.chatId && message.id > watermark,
        )
        .map((message) => [message.id, message] as const),
    ).values(),
  ].sort((a, b) => a.id - b.id);

  const aliases = new Map<string, string>();

  return ordered.map((message, index) => ({
    ...message,
    date: finiteInteger(message.date),
    authorName: message.authorName.trim(),
    text: normalizeMemoryText(message.text),
    replyToId: positiveInteger(message.replyToId),
    order: index + 1,
    authorAlias: getAuthorAlias(aliases, message.authorId),
  }));
}

export function retrieveRelevantMemory(
  table: MemoryTable,
  messages: readonly NormalizedMemoryMessage[],
  maxItems = DEFAULT_MAX_RELEVANT_MEMORY,
): MemoryItem[] {
  if (maxItems <= 0) return [];

  const scores = new Map<string, number>();
  for (const token of new Set(
    messages.flatMap(({ text }) => tokenizeMemoryText(text)),
  )) {
    for (const id of table.tokenIndex.get(token) ?? []) {
      scores.set(id, (scores.get(id) ?? 0) + 10);
    }
  }

  for (const id of table.activeByKind.get("open_question") ?? []) {
    scores.set(id, scores.get(id) ?? 0);
  }

  return [...scores]
    .flatMap(([id, score]) => {
      const item = table.byId.get(id);
      return item ? [{ item, score: score + memoryScore(item) }] : [];
    })
    .sort(compareMemoryCandidates)
    .slice(0, maxItems)
    .map(({ item }) => item);
}

export function normalizeMemoryText(text: string): string {
  return text.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function memoryScore(item: MemoryItem): number {
  return (
    Number(item.kind === "open_question") * 4 +
    Math.min(item.lastUpdatedMessageId / 1_000_000, 1)
  );
}

function compareMemoryCandidates(
  a: { item: MemoryItem; score: number },
  b: { item: MemoryItem; score: number },
): number {
  return (
    b.score - a.score ||
    b.item.lastUpdatedMessageId - a.item.lastUpdatedMessageId ||
    a.item.id.localeCompare(b.item.id)
  );
}

function getAuthorAlias(
  aliases: Map<string, string>,
  authorId: string,
): string {
  let alias = aliases.get(authorId);

  if (!alias) {
    alias = `participant_${aliases.size + 1}`;
    aliases.set(authorId, alias);
  }

  return alias;
}

function finiteInteger(value: number): number {
  return Number.isFinite(value) ? Math.trunc(value) : 0;
}

function positiveInteger(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;

  const integer = Math.trunc(value);
  return integer > 0 ? integer : undefined;
}

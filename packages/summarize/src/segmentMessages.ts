import type { ChatMessage, DiscussionSegment, SegmentReason } from "@microsonya/shared";

export const SEGMENT_TIME_GAP_MS = 30 * 60 * 1000;
export const SEGMENT_MAX_MESSAGES = 80;

export function segmentMessages(messages: ChatMessage[]): DiscussionSegment[] {
  const sorted = [...messages].sort((a, b) => a.date - b.date || a.id - b.id);
  const chunks: Array<{ messages: ChatMessage[]; reason: SegmentReason }> = [];
  let current: ChatMessage[] = [];
  let currentReason: SegmentReason = "time_gap";

  for (const message of sorted) {
    const previous = current.at(-1);
    const timeGap = previous !== undefined && message.date - previous.date > SEGMENT_TIME_GAP_MS;
    const tooLarge = current.length >= SEGMENT_MAX_MESSAGES;

    if (current.length > 0 && (timeGap || tooLarge)) {
      chunks.push({ messages: current, reason: tooLarge ? "size_limit" : "time_gap" });
      current = [];
      currentReason = tooLarge ? "size_limit" : "time_gap";
    }

    current.push(message);
  }

  if (current.length > 0) {
    chunks.push({ messages: current, reason: currentReason });
  }

  return chunks.map(toSegment);
}

function toSegment(chunk: { messages: ChatMessage[]; reason: SegmentReason }, index: number): DiscussionSegment {
  const first = chunk.messages[0];
  const last = chunk.messages.at(-1);

  if (!first || !last) {
    throw new Error("Cannot create a segment from an empty message chunk.");
  }

  return {
    id: `${first.chatId}:${first.id}-${last.id}:${index}`,
    chatId: first.chatId,
    fromMessageId: first.id,
    toMessageId: last.id,
    startDate: first.date,
    endDate: last.date,
    participants: [...new Set(chunk.messages.map((message) => message.authorName || message.authorId))],
    messageCount: chunk.messages.length,
    reason: chunk.reason,
    messages: chunk.messages
  };
}

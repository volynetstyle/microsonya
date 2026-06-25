import type {
  ChatMessage,
  DiscussionSegment,
  SegmentReason,
} from "@microsonya/shared";

export const SEGMENT_TIME_GAP_MS = 30 * 60 * 1000;
export const SEGMENT_MAX_MESSAGES = 80;

type SegmentState = {
  reason: SegmentReason;
  messages: ChatMessage[];
  participants: Set<string>;
};

function createSegmentState(reason: SegmentReason): SegmentState {
  return {
    reason,
    messages: [],
    participants: new Set(),
  };
}

function appendMessage(state: SegmentState, message: ChatMessage): void {
  state.messages.push(message);
  state.participants.add(message.authorName || message.authorId);
}

function getCloseReason(
  state: SegmentState,
  message: ChatMessage,
): SegmentReason | undefined {
  const previous = state.messages.at(-1);

  if (!previous) {
    return undefined;
  }

  if (message.date - previous.date > SEGMENT_TIME_GAP_MS) {
    return "time_gap";
  }

  if (state.messages.length >= SEGMENT_MAX_MESSAGES) {
    return "size_limit";
  }

  return undefined;
}

function stateToSegment(state: SegmentState, index: number): DiscussionSegment {
  const first = state.messages[0];
  const last = state.messages.at(-1);

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
    participants: [...state.participants],
    messageCount: state.messages.length,
    reason: state.reason,
    messages: state.messages,
  };
}

export function segmentMessages(messages: ChatMessage[]): DiscussionSegment[] {
  const sorted = [...messages].sort((a, b) => a.date - b.date || a.id - b.id);

  const segments: DiscussionSegment[] = [];
  let current = createSegmentState("time_gap");

  for (const message of sorted) {
    const closeReason = getCloseReason(current, message);

    if (current.messages.length > 0 && closeReason) {
      segments.push(stateToSegment(current, segments.length));
      current = createSegmentState(closeReason);
    }

    appendMessage(current, message);
  }

  if (current.messages.length > 0) {
    segments.push(stateToSegment(current, segments.length));
  }

  return segments;
}

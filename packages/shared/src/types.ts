export type MessageKind = "text" | "photo" | "sticker" | "voice" | "service";

export type ChatMessage = {
  id: number;
  chatId: string;
  date: number;
  authorId: string;
  authorName: string;
  text: string;
  replyToId?: number;
  kind: MessageKind;
  isCommand?: boolean;
};

export type SummaryMode = "recent" | "today" | "count";

export type SummaryCommand = {
  chatId: string;
  commandMessageId: number;
  date: number;
  mode: SummaryMode;
  count?: number;
};

export type SummaryRun = {
  id: string;
  chatId: string;
  commandMessageId: number;
  createdAt: number;
  fromMessageId: number;
  toMessageId: number;
  mode: SummaryMode;
  status: "ok" | "empty" | "too_much" | "error";
  finalText: string;
};

export type SegmentReason =
  | "time_gap"
  | "reply_cluster"
  | "topic_shift"
  | "size_limit";

export type DiscussionSegment = {
  id: string;
  chatId: string;
  fromMessageId: number;
  toMessageId: number;
  startDate: number;
  endDate: number;
  participants: string[];
  messageCount: number;
  reason: SegmentReason;
  messages: ChatMessage[];
};

export type SegmentSummary = {
  segmentId: string;
  chatId: string;
  fromMessageId: number;
  toMessageId: number;
  hash: string;
  title: string;
  summary: string[];
  decisions: string[];
  openQuestions: string[];
  jokes: string[];
  mentionedPeople: string[];
  importance: 0 | 1 | 2 | 3;
};

export type FinalSummary = {
  text: string;
};

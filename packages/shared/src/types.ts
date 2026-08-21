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

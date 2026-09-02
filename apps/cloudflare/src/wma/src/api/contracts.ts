export type WmaChat = {
  ref: string;
  title: string;
  summaryCount: number;
  lastSummaryAt: number | null;
};
export type WmaSummaryCard = {
  id: string;
  createdAt: number;
  messageCount: number;
  summary: string;
  preview: string;
};
export type WmaChatOverview = {
  chat: { ref: string; title: string };
  stats: { summaryCount: number; messageCount: number };
  summaries: readonly WmaSummaryCard[];
  nextCursor: string | null;
};
export type WmaSummaryDetail = {
  id: string;
  summary: string;
  moments: readonly {
    id: string;
    sentAt: number;
    author: string;
    body: string;
  }[];
};

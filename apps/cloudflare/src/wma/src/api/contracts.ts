export type WmaMoment =
  | { type: "text"; id: string; time: string; title: string; body: string }
  | {
      type: "quote";
      id: string;
      time: string;
      title: string;
      body: string;
      author: string;
      quote: string;
    };

export type WmaTopic = {
  id: string;
  title: string;
  messageCount: number;
  timeRange: string;
  preview: string;
  keyPointsCount: number;
  moments: readonly WmaMoment[];
};

export type WmaBootstrap = {
  viewer: { id: string; name: string };
  chat: { id: string; title: string };
  date: string;
  totalMessages: number;
  topics: readonly WmaTopic[];
  capabilities: { canRequestSummary: boolean };
};

export type WmaChat = { id: string; title: string; summaryCount: number };

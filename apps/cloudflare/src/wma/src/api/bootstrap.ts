import type { WmaChat, WmaChatOverview, WmaSummaryDetail } from "./contracts";
import { postJson } from "./http";

const initData = () => window.Telegram?.WebApp?.initData ?? "";
export const loadChats = () =>
  postJson<readonly WmaChat[]>("/api/wma/chats", initData());
export const loadChatOverview = (chatRef: string) =>
  postJson<WmaChatOverview>(
    `/api/wma/chat-overview?chatRef=${encodeURIComponent(chatRef)}`,
    initData(),
  );
export const loadSummaryDetail = (chatRef: string, summaryId: string) =>
  postJson<WmaSummaryDetail>(
    `/api/wma/summary-detail?chatRef=${encodeURIComponent(chatRef)}&summaryId=${encodeURIComponent(summaryId)}`,
    initData(),
  );

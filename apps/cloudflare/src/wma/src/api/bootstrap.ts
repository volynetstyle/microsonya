import type { WmaChat, WmaChatOverview, WmaSummaryDetail } from "./contracts";
import { fixtureResponse } from "./fixtures";
import { postJson } from "./http";

const initData = () => window.Telegram?.WebApp?.initData ?? "";
export const loadChats = () =>
  fixtureResponse<readonly WmaChat[]>("chats") ??
  postJson<readonly WmaChat[]>("/api/wma/chats", initData());
export const loadChatOverview = (chatRef: string) =>
  fixtureResponse<WmaChatOverview>("overview") ??
  postJson<WmaChatOverview>(
    `/api/wma/chat-overview?chatRef=${encodeURIComponent(chatRef)}`,
    initData(),
  );
export const loadSummaryDetail = (chatRef: string, summaryId: string) =>
  fixtureResponse<WmaSummaryDetail>("detail") ??
  postJson<WmaSummaryDetail>(
    `/api/wma/summary-detail?chatRef=${encodeURIComponent(chatRef)}&summaryId=${encodeURIComponent(summaryId)}`,
    initData(),
  );

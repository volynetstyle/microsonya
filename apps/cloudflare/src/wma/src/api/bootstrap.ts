import type { WmaChat, WmaChatOverview, WmaSummaryDetail } from "./contracts";
import { postJson } from "./http";

const initData = () => window.Telegram?.WebApp?.initData ?? "";

type FixtureResource = "chats" | "overview" | "detail";

function withDevFixture<T>(resource: FixtureResource, live: () => Promise<T>) {
  if (!import.meta.env.DEV) return live();
  return import("./fixtures").then(
    ({ fixtureResponse }) => fixtureResponse<T>(resource) ?? live(),
  );
}

export function fixtureHref(path: string): string {
  if (!import.meta.env.DEV || typeof location === "undefined") return path;
  const fixture = new URLSearchParams(location.search).get("fixture");
  if (!fixture) return path;
  const url = new URL(path, location.origin);
  url.searchParams.set("fixture", fixture);
  return `${url.pathname}${url.search}`;
}

export const loadChats = () =>
  withDevFixture<readonly WmaChat[]>("chats", () =>
    postJson<readonly WmaChat[]>("/api/wma/chats", initData()),
  );
export const loadChatOverview = (chatRef: string) =>
  withDevFixture<WmaChatOverview>("overview", () =>
    postJson<WmaChatOverview>(
      `/api/wma/chat-overview?chatRef=${encodeURIComponent(chatRef)}`,
      initData(),
    ),
  );
export const loadSummaryDetail = (chatRef: string, summaryId: string) =>
  withDevFixture<WmaSummaryDetail>("detail", () =>
    postJson<WmaSummaryDetail>(
      `/api/wma/summary-detail?chatRef=${encodeURIComponent(chatRef)}&summaryId=${encodeURIComponent(summaryId)}`,
      initData(),
    ),
  );

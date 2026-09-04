import type { WmaChat, WmaChatOverview, WmaSummaryDetail } from "./contracts";
import { postJson } from "./http";
import {
  invalidatePresentationCache,
  peekSessionCached,
  sessionCached,
} from "./session-cache";

const initData = () => window.Telegram?.WebApp?.initData ?? "";

type FixtureResource = "chats" | "overview" | "detail";

function withDevFixture<T>(resource: FixtureResource, live: () => Promise<T>) {
  if (!import.meta.env.DEV) return live();
  // Capture the story at request time. Vitest and visual harnesses may advance
  // history while this dev-only module is still loading asynchronously.
  const fixture = new URLSearchParams(location.search).get("fixture");
  return import("./fixtures").then(
    ({ fixtureResponse }) => fixtureResponse<T>(resource, fixture) ?? live(),
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
    sessionCached("chats", 60_000, () =>
      postJson<readonly WmaChat[]>("/api/wma/chats", initData()),
    ),
  );
export const peekChats = () => peekSessionCached<readonly WmaChat[]>("chats");
export const loadChatOverview = (chatRef: string, cursor?: string) =>
  withDevFixture<WmaChatOverview>("overview", () =>
    sessionCached(
      `overview:${chatRef}:${cursor ?? "first"}`,
      cursor === undefined ? 60_000 : 600_000,
      () =>
        postJson<WmaChatOverview>(
          `/api/wma/chat-overview?chatRef=${encodeURIComponent(chatRef)}${cursor === undefined ? "" : `&cursor=${encodeURIComponent(cursor)}`}`,
          initData(),
        ),
    ),
  );
export const peekChatOverview = (chatRef: string) =>
  peekSessionCached<WmaChatOverview>(`overview:${chatRef}:first`);
export const loadSummaryDetail = (chatRef: string, summaryId: string) =>
  withDevFixture<WmaSummaryDetail>("detail", () =>
    sessionCached(`detail:${chatRef}:${summaryId}`, 86_400_000, () =>
      postJson<WmaSummaryDetail>(
        `/api/wma/summary-detail?chatRef=${encodeURIComponent(chatRef)}&summaryId=${encodeURIComponent(summaryId)}`,
        initData(),
      ),
    ),
  );

export async function renameParticipant(
  chatRef: string,
  participantId: string,
  displayLabel: string | undefined,
): Promise<void> {
  await postJson<{ ok: true }>("/api/wma/participant-alias", initData(), {
    chatRef,
    participantId,
    ...(displayLabel === undefined ? {} : { displayLabel }),
  });
  invalidatePresentationCache(chatRef);
}

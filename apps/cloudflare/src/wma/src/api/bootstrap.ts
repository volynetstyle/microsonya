import type { WmaBootstrap, WmaChat } from "./contracts";
import { postJson } from "./http";
export function loadBootstrap(chatId: string): Promise<WmaBootstrap> {
  return postJson(
    `/api/wma/bootstrap?chatId=${encodeURIComponent(chatId)}`,
    window.Telegram?.WebApp?.initData ?? "",
  );
}
export function loadChats(): Promise<readonly WmaChat[]> {
  return postJson("/api/wma/chats", window.Telegram?.WebApp?.initData ?? "");
}

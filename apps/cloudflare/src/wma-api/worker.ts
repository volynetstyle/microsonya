import { TelegramInitDataError, validateTelegramInitData } from "./auth.js";
import {
  getChatOverview,
  getSummaryDetail,
  listWmaChats,
} from "./bootstrap.js";
import { errorName, logTelemetry } from "../observability.js";

export type WmaDevBindings = Readonly<{
  WMA_DEV_BYPASS_AUTH?: string;
  WMA_DEV_USER_ID?: string;
  WMA_DEV_USER_NAME?: string;
  WMA_DEV_CHAT_ID?: string;
  WMA_DEV_CHAT_TITLE?: string;
}>;
export type WmaEnv = Env & WmaDevBindings;

export default {
  async fetch(request: Request, env: WmaEnv): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/wma/")) return env.ASSETS.fetch(request);
    if (request.method !== "POST")
      return json({ error: "METHOD_NOT_ALLOWED" }, 405);
    try {
      const identity =
        env.WMA_DEV_BYPASS_AUTH === "true"
          ? devIdentity(env)
          : await validateTelegramInitData(
              request.headers.get("X-Telegram-Init-Data") ?? "",
              env.TELEGRAM_BOT_TOKEN,
            );
      if (url.pathname === "/api/wma/chats")
        return json(await listWmaChats(env, identity));
      if (url.pathname === "/api/wma/chat-overview")
        return json(
          await getChatOverview(
            env,
            identity,
            url.searchParams.get("chatRef") ?? undefined,
          ),
        );
      if (url.pathname === "/api/wma/summary-detail")
        return json(
          await getSummaryDetail(
            env,
            identity,
            url.searchParams.get("chatRef") ?? undefined,
            url.searchParams.get("summaryId") ?? undefined,
          ),
        );
      return json({ error: "NOT_FOUND" }, 404);
    } catch (error) {
      if (error instanceof TelegramInitDataError)
        return json({ error: "UNAUTHORIZED" }, 401);
      logTelemetry("error", "wma", "wma.api.failed", {
        errorName: errorName(error),
      });
      return json({ error: "INTERNAL_ERROR" }, 500);
    }
  },
} satisfies ExportedHandler<WmaEnv>;
function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function devIdentity(env: WmaEnv) {
  if (
    !env.WMA_DEV_USER_ID ||
    !env.WMA_DEV_USER_NAME ||
    !env.WMA_DEV_CHAT_ID ||
    !env.WMA_DEV_CHAT_TITLE
  )
    throw new Error("WMA dev identity is not configured.");
  return {
    user: { id: env.WMA_DEV_USER_ID, name: env.WMA_DEV_USER_NAME },
    chat: { id: env.WMA_DEV_CHAT_ID, title: env.WMA_DEV_CHAT_TITLE },
  };
}

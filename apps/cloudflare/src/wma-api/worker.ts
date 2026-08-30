import { TelegramInitDataError, validateTelegramInitData } from "./auth.js";
import { listWmaChats, loadWmaBootstrap } from "./bootstrap.js";

export interface Env {
  ASSETS: Fetcher;
  HYPERDRIVE: Hyperdrive;
  TELEGRAM_BOT_TOKEN: string;
  MICROSONYA_DATA_ENCRYPTION_KEY: string;
}
export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/wma/")) return env.ASSETS.fetch(request);
    if (request.method !== "POST")
      return json({ error: "METHOD_NOT_ALLOWED" }, 405);
    try {
      const identity = await validateTelegramInitData(
        request.headers.get("X-Telegram-Init-Data") ?? "",
        env.TELEGRAM_BOT_TOKEN,
      );
      if (url.pathname === "/api/wma/chats")
        return json(await listWmaChats(env, identity));
      if (url.pathname === "/api/wma/bootstrap")
        return json(
          await loadWmaBootstrap(
            env,
            identity,
            url.searchParams.get("chatId") ?? undefined,
            request.headers.get("X-Time-Zone") ?? undefined,
          ),
        );
      return json({ error: "NOT_FOUND" }, 404);
    } catch (error) {
      if (error instanceof TelegramInitDataError)
        return json({ error: "UNAUTHORIZED" }, 401);
      console.error("wma.api.failed", error);
      return json({ error: "INTERNAL_ERROR" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

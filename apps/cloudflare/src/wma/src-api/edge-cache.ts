import type { TelegramIdentity } from "./auth.js";

export type WmaCachePolicy = Readonly<{ ttlSeconds: number }>;

export function wmaCachePolicy(url: URL): WmaCachePolicy | undefined {
  if (url.pathname === "/api/wma/chats") return { ttlSeconds: 30 };
  // These responses are viewer-rendered: resolve aliases for every request so
  // a rename is immediately visible and never survives an edge-cache entry.
  if (
    url.pathname === "/api/wma/chat-overview" ||
    url.pathname === "/api/wma/summary-detail"
  )
    return;
  return;
}

export async function wmaCacheRequest(
  url: URL,
  identity: TelegramIdentity,
): Promise<Request> {
  const normalized = new URL(url);
  normalized.searchParams.sort();
  const material = `${identity.user.id}\0${normalized.pathname}\0${normalized.search}`;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(material),
  );
  const key = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return new Request(`https://wma-cache.internal/v1/${key}`);
}

export function clientCacheResponse(
  response: Response,
  status: "HIT" | "MISS",
): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-WMA-Cache", status);
  return new Response(response.body, { status: response.status, headers });
}

export function edgeCacheResponse(response: Response, ttlSeconds: number) {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", `public, max-age=${ttlSeconds}`);
  return new Response(response.body, { status: response.status, headers });
}

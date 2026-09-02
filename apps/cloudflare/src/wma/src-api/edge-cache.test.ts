import { describe, expect, it } from "vitest";
import {
  clientCacheResponse,
  edgeCacheResponse,
  wmaCachePolicy,
  wmaCacheRequest,
} from "./edge-cache.js";

describe("WMA edge cache", () => {
  it("uses short TTLs for mutable views and a long TTL for immutable detail", () => {
    expect(wmaCachePolicy(new URL("https://wma.test/api/wma/chats"))).toEqual({
      ttlSeconds: 30,
    });
    expect(
      wmaCachePolicy(
        new URL("https://wma.test/api/wma/chat-overview?chatRef=1"),
      ),
    ).toEqual({ ttlSeconds: 30 });
    expect(
      wmaCachePolicy(
        new URL("https://wma.test/api/wma/chat-overview?chatRef=1&cursor=next"),
      ),
    ).toEqual({ ttlSeconds: 300 });
    expect(
      wmaCachePolicy(
        new URL(
          "https://wma.test/api/wma/summary-detail?chatRef=1&summaryId=2",
        ),
      ),
    ).toEqual({ ttlSeconds: 86_400 });
  });

  it("normalizes query order and isolates cache keys by Telegram user", async () => {
    const left = await wmaCacheRequest(
      new URL("https://wma.test/api/wma/chat-overview?cursor=x&chatRef=1"),
      identity("10"),
    );
    const reordered = await wmaCacheRequest(
      new URL("https://wma.test/api/wma/chat-overview?chatRef=1&cursor=x"),
      identity("10"),
    );
    const otherUser = await wmaCacheRequest(
      new URL("https://wma.test/api/wma/chat-overview?chatRef=1&cursor=x"),
      identity("11"),
    );

    expect(left.url).toBe(reordered.url);
    expect(left.url).not.toBe(otherUser.url);
    expect(left.url).not.toContain("chatRef");
  });

  it("keeps edge TTL private from the browser", () => {
    const source = Response.json({ ok: true });
    expect(
      edgeCacheResponse(source.clone(), 30).headers.get("Cache-Control"),
    ).toBe("public, max-age=30");
    const browser = clientCacheResponse(source, "HIT");
    expect(browser.headers.get("Cache-Control")).toBe("private, no-store");
    expect(browser.headers.get("X-WMA-Cache")).toBe("HIT");
  });
});

function identity(id: string) {
  return { user: { id, name: "Reader" } };
}

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTelegramApi,
  DeliveryError,
  sendTelegramMessage,
} from "../src/processor/delivery/telegram-delivery.js";

describe("Telegram delivery boundary", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("normalizes a rejected fetch as a retryable network delivery error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new TypeError("fetch failed"))),
    );

    await expect(
      sendTelegramMessage("token", "chat", "text"),
    ).rejects.toMatchObject({
      name: "DeliveryError",
      code: "TELEGRAM_NETWORK_ERROR",
      retryable: true,
      retryAfterSeconds: 30,
    } satisfies Partial<DeliveryError>);
  });

  it("preserves a retryable HTTP failure when its body is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<h1>Bad Gateway</h1>", { status: 502 })),
    );

    await expect(
      sendTelegramMessage("token", "chat", "text"),
    ).rejects.toMatchObject({
      code: "TELEGRAM_HTTP_502",
      retryable: true,
    } satisfies Partial<DeliveryError>);
  });

  it("uses the Telegram error envelope even when HTTP succeeded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          ok: false,
          error_code: 429,
          parameters: { retry_after: 17 },
        }),
      ),
    );

    await expect(
      createTelegramApi("token").call("sendChatAction", {}),
    ).rejects.toMatchObject({
      code: "TELEGRAM_HTTP_429",
      retryable: true,
      retryAfterSeconds: 17,
    } satisfies Partial<DeliveryError>);
  });

  it("rejects an ok envelope without sendMessage message_id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ ok: true, result: {} })),
    );

    await expect(
      sendTelegramMessage("token", "chat", "text"),
    ).rejects.toMatchObject({
      code: "TELEGRAM_MALFORMED_RESPONSE",
      retryable: true,
    } satisfies Partial<DeliveryError>);
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  getAccessibleTelegramChatTitle,
  isCurrentTelegramMember,
} from "../apps/cloudflare/src/wma/src-api/chat-access.js";

describe("WMA Telegram chat access", () => {
  it.each(["creator", "administrator", "member"])(
    "allows a current %s",
    (status) => {
      expect(isCurrentTelegramMember({ status, user: { id: 42 } }, "42")).toBe(
        true,
      );
    },
  );

  it("allows a restricted user only while they remain a member", () => {
    expect(
      isCurrentTelegramMember(
        { status: "restricted", is_member: true, user: { id: 42 } },
        "42",
      ),
    ).toBe(true);
    expect(
      isCurrentTelegramMember(
        { status: "restricted", is_member: false, user: { id: 42 } },
        "42",
      ),
    ).toBe(false);
  });

  it.each(["left", "kicked"])("denies a user with status %s", (status) => {
    expect(isCurrentTelegramMember({ status, user: { id: 42 } }, "42")).toBe(
      false,
    );
  });

  it("denies malformed and mismatched member responses", () => {
    expect(isCurrentTelegramMember(undefined, "42")).toBe(false);
    expect(
      isCurrentTelegramMember({ status: "member", user: { id: 7 } }, "42"),
    ).toBe(false);
    expect(
      isCurrentTelegramMember({ status: "unknown", user: { id: 42 } }, "42"),
    ).toBe(false);
  });

  it("does not fetch or expose chat metadata for a non-member", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
      Response.json({
        ok: true,
        result: { status: "left", user: { id: 42 } },
      }),
    );

    await expect(
      getAccessibleTelegramChatTitle("secret", "-1001", "42", fetcher),
    ).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.telegram.org/botsecret/getChatMember",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("returns a title after Telegram confirms current membership", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          ok: true,
          result: { status: "member", user: { id: 42 } },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ ok: true, result: { title: "Authorized group" } }),
      );

    await expect(
      getAccessibleTelegramChatTitle("secret", "-1001", "42", fetcher),
    ).resolves.toBe("Authorized group");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("fails closed when Telegram is unavailable", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("network unavailable"));

    await expect(
      getAccessibleTelegramChatTitle("secret", "-1001", "42", fetcher),
    ).resolves.toBeUndefined();
  });
});

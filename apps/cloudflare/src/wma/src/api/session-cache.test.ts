import { beforeEach, describe, expect, it, vi } from "vitest";
import { sessionCached } from "./session-cache";

describe("WMA session cache", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.useRealTimers();
    window.Telegram = {
      WebApp: { initDataUnsafe: { user: { id: 42 } } },
    } as typeof window.Telegram;
  });

  it("reuses a fresh response without repeating the loader", async () => {
    const load = vi.fn(async () => ({ summaries: ["one"] }));

    await expect(
      sessionCached("overview:chat:first", 60_000, load),
    ).resolves.toEqual({ summaries: ["one"] });
    await expect(
      sessionCached("overview:chat:first", 60_000, load),
    ).resolves.toEqual({ summaries: ["one"] });

    expect(load).toHaveBeenCalledTimes(1);
  });

  it("reloads expired data", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-02T12:00:00Z"));
    const load = vi
      .fn<() => Promise<number>>()
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2);

    await expect(sessionCached("chats", 1_000, load)).resolves.toBe(1);
    vi.advanceTimersByTime(1_001);
    await expect(sessionCached("chats", 1_000, load)).resolves.toBe(2);
    expect(load).toHaveBeenCalledTimes(2);
  });
});

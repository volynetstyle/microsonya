import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ReplySession,
  type ReplyUpdate,
} from "../apps/telegram/bot/src/replySession.js";

afterEach(() => vi.useRealTimers());

describe("ReplySession", () => {
  it("suppresses delayed progress for a fast final response", async () => {
    vi.useFakeTimers();
    const updates: ReplyUpdate[] = [];
    const send = vi.fn(async () => undefined);
    const reply = createReply(updates, send);

    await reply.progress("Analysing");
    await reply.finish("final");
    await vi.runAllTimersAsync();

    expect(updates).toEqual([{ type: "complete", text: "final" }]);
    expect(send).not.toHaveBeenCalled();
  });

  it("uses the latest progress text once the delay expires", async () => {
    vi.useFakeTimers();
    const updates: ReplyUpdate[] = [];
    const reply = createReply(
      updates,
      vi.fn(async () => undefined),
    );

    await reply.progress("0/3");
    await reply.progress("1/3");
    await vi.advanceTimersByTimeAsync(750);
    await reply.finish("final");

    expect(updates).toEqual([
      { type: "progress", text: "1/3" },
      { type: "complete", text: "final" },
    ]);
  });

  it("serializes draft writes and finishes at most once", async () => {
    const updates: ReplyUpdate[] = [];
    const releases: (() => void)[] = [];
    const reply = new ReplySession({
      draft: {
        update: (update) => {
          updates.push(update);
          return new Promise<void>((resolve) => releases.push(resolve));
        },
      },
      send: vi.fn(async () => undefined),
      progressDelayMs: 0,
    });

    await reply.progress("working");
    await new Promise((resolve) => setTimeout(resolve, 0));
    const finish = reply.finish("final");
    const duplicate = reply.finish("ignored");
    await Promise.resolve();
    expect(updates).toEqual([{ type: "progress", text: "working" }]);

    releases.shift()!();
    await vi.waitFor(() =>
      expect(updates.at(-1)).toEqual({ type: "complete", text: "final" }),
    );

    releases.shift()!();
    await Promise.all([finish, duplicate]);
    expect(updates).toHaveLength(2);
  });

  it("permanently falls back after a draft failure", async () => {
    vi.useFakeTimers();
    const update = vi.fn(async () => {
      throw new Error("Telegram down");
    });
    const send = vi.fn(async () => undefined);
    const reply = new ReplySession({
      draft: { update },
      send,
      progressDelayMs: 750,
    });

    await reply.progress("Analysing");
    await vi.advanceTimersByTimeAsync(750);
    await reply.finish("final");

    expect(update).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith("final");
  });

  it("uses an ordinary final reply when no draft transport exists", async () => {
    const send = vi.fn(async () => undefined);
    const reply = new ReplySession({ send });
    await reply.progress("silent");
    await reply.finish("final");
    expect(send).toHaveBeenCalledWith("final");
  });
});

function createReply(
  updates: ReplyUpdate[],
  send: (text: string) => Promise<void>,
): ReplySession {
  return new ReplySession({
    draft: { update: async (update) => void updates.push(update) },
    send,
    progressDelayMs: 750,
  });
}

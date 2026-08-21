import { afterEach, describe, expect, it, vi } from "vitest";
import { SummaryPresentationSession } from "../apps/telegram/bot/src/summaryPresentation.js";
import type { DraftState } from "../apps/telegram/bot/src/telegram/draftStream.js";

afterEach(() => vi.useRealTimers());

describe("SummaryPresentationSession", () => {
  it("sends only the final message when no stream was armed", async () => {
    vi.useFakeTimers();
    const states: DraftState[] = [];
    const session = createSession(
      states,
      vi.fn(async () => undefined),
    );

    await session.complete("final");
    await vi.runAllTimersAsync();

    expect(states).toEqual([{ type: "complete", text: "final" }]);
  });

  it("does not create a draft for a fast result", async () => {
    vi.useFakeTimers();
    const states: DraftState[] = [];
    const fallback = vi.fn(async () => undefined);
    const session = createSession(states, fallback);

    session.arm();
    await session.complete("final");
    await vi.runAllTimersAsync();

    expect(states).toEqual([{ type: "complete", text: "final" }]);
    expect(fallback).not.toHaveBeenCalled();
  });

  it("shows native thinking only after the delay", async () => {
    vi.useFakeTimers();
    const states: DraftState[] = [];
    const session = createSession(
      states,
      vi.fn(async () => undefined),
    );

    session.arm();
    await vi.advanceTimersByTimeAsync(750);
    await session.complete("final");

    expect(states).toEqual([
      { type: "thinking" },
      { type: "complete", text: "final" },
    ]);
  });

  it("coalesces progress into the latest delayed status", async () => {
    vi.useFakeTimers();
    const states: DraftState[] = [];
    const session = createSession(
      states,
      vi.fn(async () => undefined),
    );

    await session.status("Аналізую… 0/3");
    await session.status("Аналізую… 1/3");
    expect(states).toEqual([]);

    await vi.advanceTimersByTimeAsync(750);

    expect(states).toEqual([{ type: "thinking", text: "Аналізую… 1/3" }]);
  });

  it("accepts validated snapshots and ignores calls after completion", async () => {
    vi.useFakeTimers();
    const states: DraftState[] = [];
    const session = createSession(
      states,
      vi.fn(async () => undefined),
    );

    session.arm();
    await session.snapshot("validated section");
    await session.complete("final");
    await session.snapshot("late");
    await session.fail("late failure");

    expect(states).toEqual([
      { type: "streaming", text: "validated section" },
      { type: "complete", text: "final" },
    ]);
  });

  it("falls back when native Telegram output fails", async () => {
    vi.useFakeTimers();
    const fallback = vi.fn(async () => undefined);
    const session = new SummaryPresentationSession(
      { update: vi.fn(async () => Promise.reject(new Error("Telegram down"))) },
      fallback,
      { thinkingDelayMs: 750 },
    );

    session.arm();
    await vi.advanceTimersByTimeAsync(750);
    await session.complete("final");

    expect(fallback).toHaveBeenCalledOnce();
    expect(fallback).toHaveBeenCalledWith("final");
  });
});

function createSession(
  states: DraftState[],
  fallback: (text: string) => Promise<void>,
): SummaryPresentationSession {
  return new SummaryPresentationSession(
    {
      update: async (state) => {
        states.push(state);
      },
    },
    fallback,
    { thinkingDelayMs: 750 },
  );
}

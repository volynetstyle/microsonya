import { describe, expect, it, vi } from "vitest";
import {
  streamTextAsDraft,
  type DraftState,
} from "../apps/telegram/bot/src/telegram/draftStream.js";

describe("Telegram draft streaming", () => {
  it("emits thinking, coalesced streaming snapshots, and complete", async () => {
    let time = 0;
    const states: DraftState[] = [];

    async function* deltas() {
      for (const delta of ["hello ", "streaming ", "world"]) {
        yield delta;
        time += 100;
      }
    }

    const result = await streamTextAsDraft(
      deltas(),
      { update: async (state) => states.push(state) },
      {
        flushIntervalMs: 250,
        minNewChars: 5,
        now: () => time,
        sleep: async (milliseconds) => {
          time += milliseconds;
        },
      },
    );

    expect(states[0]).toEqual({ type: "thinking" });
    expect(states.at(-1)).toEqual({
      type: "complete",
      text: "hello streaming world",
    });
    const snapshots = states.flatMap((state) =>
      state.type === "streaming" ? [state.text] : [],
    );
    expect(snapshots.at(-1)).toBe("hello streaming world");
    expect(
      snapshots.every((draft, index) =>
        index === 0 ? true : draft.startsWith(snapshots[index - 1]),
      ),
    ).toBe(true);
    expect(result).toBe("hello streaming world");
  });

  it("does not block delta production on a slow draft update", async () => {
    let produced = 0;
    let releaseSleep: (() => void) | undefined;

    async function* deltas() {
      for (const delta of ["one", "two", "three"]) {
        produced += 1;
        yield delta;
      }
    }

    const streaming = streamTextAsDraft(
      deltas(),
      { update: async () => undefined },
      {
        flushIntervalMs: 800,
        minNewChars: 1,
        now: () => 0,
        sleep: () =>
          new Promise<void>((resolve) => {
            releaseSleep = resolve;
          }),
      },
    );

    await vi.waitFor(() => expect(releaseSleep).toBeTypeOf("function"));
    expect(produced).toBe(3);
    releaseSleep?.();
    await streaming;
  });

  it("coalesces a hot stream of 10,000 tiny deltas", async () => {
    const states: DraftState[] = [];

    async function* deltas() {
      for (let index = 0; index < 10_000; index += 1) yield "x";
    }

    await streamTextAsDraft(
      deltas(),
      { update: async (state) => states.push(state) },
      {
        flushIntervalMs: 0,
        minNewChars: 10_000,
        sleep: async () => undefined,
      },
    );

    expect(states).toHaveLength(3);
    expect(states[0]).toEqual({ type: "thinking" });
    expect(states[1]).toEqual({ type: "streaming", text: "x".repeat(10_000) });
    expect(states[2]).toEqual({ type: "complete", text: "x".repeat(10_000) });
  });
});

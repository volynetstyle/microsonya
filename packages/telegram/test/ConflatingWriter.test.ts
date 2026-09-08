import { afterEach, describe, expect, it, vi } from "vitest";
import { ConflatingWriter } from "../src/index.js";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => vi.useRealTimers());

describe("ConflatingWriter", () => {
  it("starts the first update immediately", () => {
    const writes: string[] = [];
    const writer = new ConflatingWriter<string>(
      async (value) => {
        writes.push(value);
      },
      { delayMs: () => 900 },
    );
    writer.update("A");
    expect(writes).toEqual(["A"]);
  });

  it("conflates updates received while a write is in flight", async () => {
    const first = deferred();
    const writes: string[] = [];
    const writer = new ConflatingWriter<string>(
      async (value) => {
        writes.push(value);
        if (value === "A") await first.promise;
      },
      { delayMs: () => 0 },
    );
    writer.update("A");
    writer.update("AB");
    writer.update("ABC");
    writer.update("ABCD");
    expect(writes).toEqual(["A"]);
    first.resolve();
    await settle();
    expect(writes).toEqual(["A", "ABCD"]);
  });

  it("never performs more than one physical write concurrently", async () => {
    const releases = [deferred(), deferred()];
    let active = 0;
    let maxActive = 0;
    let index = 0;
    const writer = new ConflatingWriter<string>(
      async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await releases[index++]!.promise;
        active -= 1;
      },
      { delayMs: () => 0 },
    );
    writer.update("A");
    writer.update("AB");
    releases[0]!.resolve();
    await settle();
    expect(maxActive).toBe(1);
    releases[1]!.resolve();
    await settle();
    expect(maxActive).toBe(1);
  });

  it("writes only the latest value when the timer flushes", async () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    const writer = new ConflatingWriter<string>(
      async (value) => {
        writes.push(value);
      },
      { delayMs: () => 900 },
    );
    writer.update("A");
    await settle();
    await vi.advanceTimersByTimeAsync(100);
    writer.update("AB");
    await vi.advanceTimersByTimeAsync(50);
    writer.update("ABC");
    await vi.advanceTimersByTimeAsync(50);
    writer.update("ABCD");
    await vi.advanceTimersByTimeAsync(699);
    expect(writes).toEqual(["A"]);
    await vi.advanceTimersByTimeAsync(1);
    expect(writes).toEqual(["A", "ABCD"]);
  });

  it("does not let continuous updates starve timer flushes", async () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    const writer = new ConflatingWriter<string>(
      async (value) => {
        writes.push(value);
      },
      { delayMs: () => 900 },
    );
    writer.update("A");
    await settle();
    for (let index = 1; index <= 200; index += 1) {
      await vi.advanceTimersByTimeAsync(50);
      writer.update("A" + "x".repeat(index));
    }
    await vi.runOnlyPendingTimersAsync();
    expect(writes.length).toBeGreaterThan(10);
    expect(writes.at(-1)).toBe("A" + "x".repeat(200));
  });

  it("measures cadence from request start rather than after RTT", async () => {
    vi.useFakeTimers();
    const origin = Date.now();
    const first = deferred();
    const starts: number[] = [];
    const writer = new ConflatingWriter<string>(
      async (value) => {
        starts.push(Date.now());
        if (value === "A") await first.promise;
      },
      { delayMs: () => 400 },
    );
    writer.update("A");
    writer.update("AB");
    await vi.advanceTimersByTimeAsync(300);
    first.resolve();
    await settle();
    await vi.advanceTimersByTimeAsync(99);
    expect(starts).toEqual([origin]);
    await vi.advanceTimersByTimeAsync(1);
    expect(starts).toEqual([origin, origin + 400]);
  });

  it("applies cooldown after a slow successful write", async () => {
    vi.useFakeTimers();
    const origin = Date.now();
    const first = deferred();
    const starts: number[] = [];
    const writer = new ConflatingWriter<string>(
      async (value) => {
        starts.push(Date.now());
        if (value === "A") await first.promise;
      },
      {
        delayMs: () => 1_000,
        slowRequestThresholdMs: 1_500,
        congestionCooldownMs: 1_000,
      },
    );

    writer.update("A");
    writer.update("LATEST");
    await vi.advanceTimersByTimeAsync(3_000);
    first.resolve();
    await settle();
    await vi.advanceTimersByTimeAsync(999);
    expect(starts).toEqual([origin]);
    await vi.advanceTimersByTimeAsync(1);
    expect(starts).toEqual([origin, origin + 4_000]);
  });

  it("drops obsolete pending state and waits for in-flight on finalize", async () => {
    const first = deferred();
    const writes: string[] = [];
    const writer = new ConflatingWriter<string>(
      async (value) => {
        writes.push(value);
        if (value === "A") await first.promise;
      },
      { delayMs: () => 900 },
    );
    writer.update("A");
    writer.update("AB");
    writer.update("ABCD");
    const completion = writer.finalize("FINAL");
    await settle();
    expect(writes).toEqual(["A"]);
    first.resolve();
    await completion;
    expect(writes).toEqual(["A", "FINAL"]);
  });

  it("suppresses a duplicate final physical write", async () => {
    const writes: string[] = [];
    const writer = new ConflatingWriter<string>(
      async (value) => {
        writes.push(value);
      },
      { delayMs: () => 0 },
    );
    writer.update("FINAL");
    await settle();
    await writer.finalize("FINAL");
    expect(writes).toEqual(["FINAL"]);
  });

  it("reports intermediate failure without poisoning finalization", async () => {
    const failure = new Error("intermediate");
    const errors: unknown[] = [];
    const writes: string[] = [];
    const writer = new ConflatingWriter<string>(
      async (value) => {
        writes.push(value);
        if (value === "A") throw failure;
      },
      {
        delayMs: () => 0,
        onIntermediateError: (error) => errors.push(error),
      },
    );
    writer.update("A");
    writer.update("AB");
    await settle();
    await writer.finalize("FINAL");
    expect(errors).toEqual([failure]);
    expect(writes.at(-1)).toBe("FINAL");
  });

  it("propagates terminal failure and permits another terminal attempt", async () => {
    const failure = new Error("terminal");
    let attempts = 0;
    const writer = new ConflatingWriter<string>(
      async () => {
        attempts += 1;
        if (attempts === 1) throw failure;
      },
      { delayMs: () => 0 },
    );
    await expect(writer.finalize("FINAL")).rejects.toBe(failure);
    await expect(writer.finalize("ERROR")).resolves.toBeUndefined();
  });

  it("forbids updates after successful finalization", async () => {
    const writer = new ConflatingWriter<string>(async () => undefined, {
      delayMs: () => 0,
    });
    await writer.finalize("FINAL");
    expect(() => writer.update("oops")).toThrow(/finalized/u);
  });
});

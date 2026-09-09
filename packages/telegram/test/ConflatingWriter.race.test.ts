import { describe, expect, it } from "vitest";
import { ConflatingWriter } from "../src/index.js";

function deferred() {
  let resolve!: () => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("ConflatingWriter races", () => {
  it("preserves serialization and terminal authority across deterministic schedules", async () => {
    for (const pendingCount of [0, 1, 2, 16]) {
      const first = deferred();
      const successfulWrites: string[] = [];
      let concurrent = 0;
      let maxConcurrent = 0;
      const writer = new ConflatingWriter<string>(
        async (value) => {
          concurrent += 1;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          if (value === "A") await first.promise;
          successfulWrites.push(value);
          concurrent -= 1;
        },
        { delayMs: () => 0 },
      );

      writer.update("A");
      for (let index = 0; index < pendingCount; index += 1) {
        writer.update(`pending-${index}`);
      }
      const terminal = `FINAL-${pendingCount}`;
      const completion = writer.finalize(terminal);
      first.resolve();
      await completion;

      expect(maxConcurrent).toBe(1);
      expect(successfulWrites.at(-1)).toBe(terminal);
      expect(successfulWrites).toEqual(["A", terminal]);
    }
  });

  it("recovers when the in-flight intermediate request rejects", async () => {
    const first = deferred();
    const successfulWrites: string[] = [];
    let calls = 0;
    const writer = new ConflatingWriter<string>(
      async (value) => {
        calls += 1;
        if (calls === 1) {
          await first.promise;
          throw new Error("network");
        }
        successfulWrites.push(value);
      },
      { delayMs: () => 0 },
    );

    writer.update("A");
    writer.update("AB");
    const completion = writer.finalize("FINAL");
    first.resolve();
    await completion;

    expect(successfulWrites.at(-1)).toBe("FINAL");
  });
});

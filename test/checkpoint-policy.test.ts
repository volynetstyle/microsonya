import { describe, expect, it } from "vitest";
import { shouldAdvanceCheckpoint } from "../packages/summarize/src/index.js";

describe("summary checkpoint state machine", () => {
  it.each([
    ["SUMMARIZE", "success", true],
    ["SUMMARIZE", "failure", false],
    ["DEFER_COMPACT", "success", false],
    ["DEFER_INCOMPLETE", "success", false],
    ["DEFER_CONTEXT", "success", false],
    ["SKIP_REACTIONS", "success", true],
    ["SKIP_BANTER", "success", true],
    ["SKIP_NO_VALUE", "success", true],
    ["EMPTY", "success", false],
  ] as const)("%s / %s advances=%s", (action, outcome, expected) => {
    expect(shouldAdvanceCheckpoint(action, outcome)).toBe(expected);
  });
});

import { describe, expect, it } from "vitest";
import {
  createWindow,
  hullWindows,
  intersectWindows,
  relateWindows,
  subtractWindows,
} from "../packages/shared/src/index.js";

const compare = (left: number, right: number) => left - right;

describe("half-open window algebra", () => {
  it("keeps adjacent windows disjoint", () => {
    const left = createWindow(1, 3, compare);
    const right = createWindow(3, 5, compare);
    expect(intersectWindows(left, right, compare)).toBeUndefined();
    expect(relateWindows(left, right, compare)).toBe("disjoint");
    expect(hullWindows(left, right, compare)).toEqual({ start: 1, end: 5 });
  });

  it("distinguishes exact, containment, and overlap", () => {
    const outer = createWindow(1, 8, compare);
    expect(relateWindows(outer, createWindow(1, 8, compare), compare)).toBe(
      "exact",
    );
    expect(relateWindows(createWindow(2, 5, compare), outer, compare)).toBe(
      "contained",
    );
    expect(relateWindows(outer, createWindow(2, 5, compare), compare)).toBe(
      "contains",
    );
    expect(relateWindows(outer, createWindow(7, 10, compare), compare)).toBe(
      "overlap",
    );
  });

  it("returns a normalized set of at most two windows for difference", () => {
    expect(
      subtractWindows(
        createWindow(1, 10, compare),
        createWindow(4, 7, compare),
        compare,
      ),
    ).toEqual([
      { start: 1, end: 4 },
      { start: 7, end: 10 },
    ]);
    expect(
      subtractWindows(
        createWindow(1, 3, compare),
        createWindow(3, 5, compare),
        compare,
      ),
    ).toEqual([{ start: 1, end: 3 }]);
  });
});

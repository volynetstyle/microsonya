import { describe, expect, it } from "vitest";
import type { PopoverPlacement } from "./popover-context";
import {
  placementAxes,
  positionFromAxes,
  resolvePopoverPosition,
} from "./popover-position";

describe("popover fallback vector", () => {
  const anchor = { left: 100, top: 200, width: 40, height: 30 };
  const popup = { width: 80, height: 60 };

  it.each<[PopoverPlacement, number, number]>([
    ["bottom-start", 100, 237],
    ["bottom-end", 60, 237],
    ["top-start", 100, 133],
    ["top-end", 60, 133],
  ])(
    "derives %s without placement-specific branches",
    (placement, left, top) => {
      expect(
        positionFromAxes(anchor, popup, placementAxes(placement), 7),
      ).toEqual({ left, top });
    },
  );

  it("resolves block and inline fallbacks as axis inversions", () => {
    const resolved = resolvePopoverPosition(
      { left: 270, top: 170, width: 30, height: 20 },
      { width: 100, height: 80 },
      placementAxes("bottom-start"),
      { width: 320, height: 200 },
      7,
      6,
    );

    expect(resolved).toEqual({
      axes: { above: true, inlineEnd: true },
      left: 200,
      top: 83,
    });
  });
});

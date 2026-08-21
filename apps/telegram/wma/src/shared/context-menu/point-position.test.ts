import { describe, expect, it } from "vitest";
import { resolvePointPlacement } from "./point-position";

describe("context-menu point placement", () => {
  const viewport = { width: 320, height: 200 };
  const menu = { width: 100, height: 80 };

  it("opens to the bottom-right of a point when there is room", () => {
    expect(resolvePointPlacement({ x: 100, y: 50 }, menu, viewport)).toEqual({
      x: 103,
      y: 50,
      sideX: 1,
      sideY: 1,
      maxHeight: 138,
    });
  });

  it("flips independently and keeps the menu in the safe viewport", () => {
    expect(resolvePointPlacement({ x: 300, y: 190 }, menu, viewport)).toEqual({
      x: 197,
      y: 108,
      sideX: -1,
      sideY: -1,
      maxHeight: 172,
    });
  });

  it("adds Telegram safe areas before applying legacy margins", () => {
    expect(
      resolvePointPlacement(
        { x: 10, y: 20 },
        { width: 80, height: 40 },
        { width: 320, height: 200, safeArea: { left: 20, top: 10 } },
      ),
    ).toEqual({
      x: 36,
      y: 26,
      sideX: 1,
      sideY: 1,
      maxHeight: 162,
    });
  });
});

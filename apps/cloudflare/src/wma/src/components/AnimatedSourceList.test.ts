import { describe, expect, it } from "vitest";
import { sourceGradientOpacities } from "./AnimatedSourceList";

describe("sourceGradientOpacities", () => {
  it("preserves the React Bits 50px edge physics", () => {
    expect(sourceGradientOpacities(0, 500)).toEqual({ top: 0, bottom: 1 });
    expect(sourceGradientOpacities(25, 500)).toEqual({
      top: 0.5,
      bottom: 1,
    });
    expect(sourceGradientOpacities(475, 500)).toEqual({
      top: 1,
      bottom: 0.5,
    });
    expect(sourceGradientOpacities(500, 500)).toEqual({ top: 1, bottom: 0 });
  });

  it("hides both gradients when the list does not overflow", () => {
    expect(sourceGradientOpacities(0, 0)).toEqual({ top: 0, bottom: 0 });
  });

  it("clamps elastic overscroll without producing invalid opacity", () => {
    expect(sourceGradientOpacities(-24, 100)).toEqual({ top: 0, bottom: 1 });
    expect(sourceGradientOpacities(124, 100)).toEqual({ top: 1, bottom: 0 });
  });
});

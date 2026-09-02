import { describe, expect, it } from "vitest";
import { availableSourceWindowHeight } from "./source-window";

describe("availableSourceWindowHeight", () => {
  it("subtracts every already-rendered WMA region above and below the list", () => {
    expect(
      availableSourceWindowHeight({
        viewportHeight: 800,
        windowTop: 286,
        screenPaddingBottom: 24,
        screenMarginBottom: 16,
      }),
    ).toBe(474);
  });

  it("never grows beyond the space left in a short WMA viewport", () => {
    expect(
      availableSourceWindowHeight({
        viewportHeight: 360,
        windowTop: 260,
        screenPaddingBottom: 20,
        screenMarginBottom: 0,
      }),
    ).toBe(80);
  });

  it("clamps a completely occluded window to zero", () => {
    expect(
      availableSourceWindowHeight({
        viewportHeight: 300,
        windowTop: 310,
        screenPaddingBottom: 20,
        screenMarginBottom: 0,
      }),
    ).toBe(0);
  });
});

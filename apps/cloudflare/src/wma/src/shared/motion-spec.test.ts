import { describe, expect, it } from "vitest";
import {
  accordionEdgeSeparated,
  cubicBezierProgress,
  LEGACY_MOTION,
} from "./motion-spec";

describe("legacy motion reference oracle", () => {
  it.each([
    [0.125, 0.04296875],
    [0.25, 0.2365873605],
    [0.35, 0.5],
    [0.5, 0.7755613111],
    [0.75, 0.9593677367],
  ])("matches the AccordionSwift curve at %f", (time, expected) => {
    expect(
      cubicBezierProgress(time, LEGACY_MOTION.accordion.geometry.easing),
    ).toBeCloseTo(expected, 8);
  });

  it.each([
    [0.25, 0.129161931],
    [0.5, 0.5],
    [0.75, 0.870838069],
  ])("matches the legacy dropdown curve at %f", (time, expected) => {
    expect(cubicBezierProgress(time, LEGACY_MOTION.popover.easing)).toBeCloseTo(
      expected,
      8,
    );
  });

  it.each([
    [0.25, 0.3781381308],
    [0.5, 0.6846431874],
    [0.75, 0.9065353493],
  ])("matches the legacy context-menu curve at %f", (time, expected) => {
    expect(
      cubicBezierProgress(time, LEGACY_MOTION.contextMenu.easing),
    ).toBeCloseTo(expected, 8);
  });

  it.each([
    [false, false, false],
    [false, true, true],
    [true, false, true],
    [true, true, true],
  ])(
    "derives an accordion boundary from %s OR %s",
    (before, after, separated) => {
      expect(accordionEdgeSeparated(before, after)).toBe(separated);
    },
  );

});

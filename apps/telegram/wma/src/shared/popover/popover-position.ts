import type { PopoverPlacement } from "./popover-context";

export interface RectSize {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface PopoverAxes {
  inlineEnd: boolean;
  above: boolean;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export interface ResolvedPopoverPosition {
  axes: PopoverAxes;
  left: number;
  top: number;
}

/** Converts the readable placement API into its two independent axes. */
export function placementAxes(placement: PopoverPlacement): PopoverAxes {
  return {
    inlineEnd: placement.endsWith("end"),
    above: placement.startsWith("top"),
  };
}

/**
 * Computes all four fallback placements from one vector model:
 * anchor point + 7px normal offset - matching popup origin.
 */
export function positionFromAxes(
  anchor: RectSize,
  popup: Size,
  axes: PopoverAxes,
  offset: number,
): { left: number; top: number } {
  const horizontal = Number(axes.inlineEnd);
  const vertical = Number(axes.above);

  const anchorX = anchor.left + horizontal * anchor.width;
  const anchorY = anchor.top + (1 - vertical) * anchor.height;
  const originX = horizontal * popup.width;
  const originY = vertical * popup.height;
  const normalY = 1 - 2 * vertical;

  return {
    left: anchorX - originX,
    top: anchorY + offset * normalY - originY,
  };
}

/** Resolves block/inline flips and viewport clamping without DOM access. */
export function resolvePopoverPosition(
  anchor: RectSize,
  popup: Size,
  preferred: PopoverAxes,
  viewport: ViewportSize,
  offset: number,
  margin: number,
): ResolvedPopoverPosition {
  let axes = preferred;
  let point = positionFromAxes(anchor, popup, axes, offset);

  const overflowsBlock = axes.above
    ? point.top < margin
    : point.top + popup.height > viewport.height - margin;

  if (overflowsBlock) {
    axes = { ...axes, above: !axes.above };
    point = positionFromAxes(anchor, popup, axes, offset);
  }

  const overflowsInline =
    point.left < margin || point.left + popup.width > viewport.width - margin;

  if (overflowsInline) {
    const flippedAxes = { ...axes, inlineEnd: !axes.inlineEnd };
    const flippedPoint = positionFromAxes(anchor, popup, flippedAxes, offset);
    const flippedFits =
      flippedPoint.left >= margin &&
      flippedPoint.left + popup.width <= viewport.width - margin;

    if (flippedFits) {
      axes = flippedAxes;
      point = flippedPoint;
    }
  }

  return {
    axes,
    left: Math.min(
      viewport.width - popup.width - margin,
      Math.max(margin, point.left),
    ),
    top: Math.min(
      viewport.height - popup.height - margin,
      Math.max(margin, point.top),
    ),
  };
}

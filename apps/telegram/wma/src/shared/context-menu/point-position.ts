export interface Point {
  x: number;
  y: number;
}

export interface PopupSize {
  width: number;
  height: number;
}

export interface ViewportBounds {
  width: number;
  height: number;
  safeArea?: Partial<ViewportInsets>;
}

export interface ViewportInsets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface PointPositionConfig {
  gapX: number;
  gapY: number;
  marginLeft: number;
  marginRight: number;
  marginTop: number;
  marginBottom: number;
}

export const LEGACY_POINT_POSITION: PointPositionConfig = {
  gapX: 3,
  gapY: 0,
  marginLeft: 16,
  marginRight: 16,
  marginTop: 16,
  marginBottom: 12,
};

export interface ResolvedPointPlacement {
  x: number;
  y: number;
  sideX: -1 | 1;
  sideY: -1 | 1;
  maxHeight: number;
}

/** Resolves a cursor point into a clamped menu rectangle without DOM access. */
export function resolvePointPlacement(
  point: Point,
  popup: PopupSize,
  viewport: ViewportBounds,
  override: Partial<PointPositionConfig> = {},
): ResolvedPointPlacement {
  const config = { ...LEGACY_POINT_POSITION, ...override };
  const safe = {
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    ...viewport.safeArea,
  };
  const left = safe.left + config.marginLeft;
  const right = viewport.width - safe.right - config.marginRight;
  const top = safe.top + config.marginTop;
  const bottom = viewport.height - safe.bottom - config.marginBottom;

  const sideX: -1 | 1 =
    point.x + config.gapX + popup.width <= right ? 1 : -1;
  const sideY: -1 | 1 =
    point.y + config.gapY + popup.height <= bottom ? 1 : -1;

  const initialX =
    sideX === 1
      ? point.x + config.gapX
      : point.x - popup.width - config.gapX;
  const initialY =
    sideY === 1
      ? point.y + config.gapY
      : point.y - popup.height - config.gapY;

  const maxX = Math.max(left, right - popup.width);
  const maxY = Math.max(top, bottom - popup.height);
  const x = clamp(initialX, left, maxX);
  const y = clamp(initialY, top, maxY);

  const availableHeight =
    sideY === 1
      ? bottom - point.y - config.gapY
      : point.y - top - config.gapY;

  return {
    x,
    y,
    sideX,
    sideY,
    maxHeight: Math.max(0, Math.min(bottom - top, availableHeight)),
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

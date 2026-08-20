export type CubicBezier = readonly [
  x1: number,
  y1: number,
  x2: number,
  y2: number,
];

/** Exact observable contract inherited from the AWEverse primitives. */
export const LEGACY_MOTION = {
  accordion: {
    gap: "0.5rem",
    radius: "0.5rem",
    geometry: {
      durationMs: 200,
      easing: [0.4, 0, 0.2, 1] as CubicBezier,
    },
    opacity: {
      enterRatio: 0.75,
      exitRatio: 0.5,
      easing: "linear",
    },
    contentOffset: "0px",
  },
  popover: {
    offset: "0.4375rem",
    durationMs: 125,
    easing: [0.42, 0, 0.58, 1] as CubicBezier,
    scaleFrom: 0.85,
  },
} as const;

/** Reference oracle for tests; production animation remains native CSS. */
export function cubicBezierProgress(
  progress: number,
  [x1, y1, x2, y2]: CubicBezier,
): number {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;

  let low = 0;
  let high = 1;

  for (let index = 0; index < 48; index++) {
    const parameter = (low + high) * 0.5;
    if (cubic(parameter, x1, x2) < progress) low = parameter;
    else high = parameter;
  }

  return cubic((low + high) * 0.5, y1, y2);
}

/** Boundary topology: a boundary separates when either neighbour is open. */
export function accordionEdgeSeparated(
  beforeOpen: boolean,
  afterOpen: boolean,
): boolean {
  return beforeOpen || afterOpen;
}

function cubic(parameter: number, point1: number, point2: number): number {
  const inverse = 1 - parameter;
  return (
    3 * inverse * inverse * parameter * point1 +
    3 * inverse * parameter * parameter * point2 +
    parameter * parameter * parameter
  );
}

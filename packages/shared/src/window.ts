/** A half-open interval over a totally ordered position domain. */
export interface Window<Position> {
  readonly start: Position;
  readonly end: Position;
}

export type WindowRelation =
  | "exact"
  | "contained"
  | "contains"
  | "overlap"
  | "disjoint";

export type WindowSet<Position> = readonly Window<Position>[];

export type ComparePosition<Position> = (
  left: Position,
  right: Position,
) => number;

export function createWindow<Position>(
  start: Position,
  end: Position,
  compare: ComparePosition<Position>,
): Window<Position> {
  if (compare(start, end) >= 0) {
    throw new RangeError("Window start must precede its end.");
  }
  return { start, end };
}

export function intersectWindows<Position>(
  left: Window<Position>,
  right: Window<Position>,
  compare: ComparePosition<Position>,
): Window<Position> | undefined {
  const start =
    compare(left.start, right.start) >= 0 ? left.start : right.start;
  const end = compare(left.end, right.end) <= 0 ? left.end : right.end;
  return compare(start, end) < 0 ? { start, end } : undefined;
}

/** Convex hull, deliberately not a set union when the inputs are disjoint. */
export function hullWindows<Position>(
  left: Window<Position>,
  right: Window<Position>,
  compare: ComparePosition<Position>,
): Window<Position> {
  return {
    start: compare(left.start, right.start) <= 0 ? left.start : right.start,
    end: compare(left.end, right.end) >= 0 ? left.end : right.end,
  };
}

export function relateWindows<Position>(
  left: Window<Position>,
  right: Window<Position>,
  compare: ComparePosition<Position>,
): WindowRelation {
  const starts = compare(left.start, right.start);
  const ends = compare(left.end, right.end);
  if (starts === 0 && ends === 0) return "exact";
  if (starts >= 0 && ends <= 0) return "contained";
  if (starts <= 0 && ends >= 0) return "contains";
  return intersectWindows(left, right, compare) ? "overlap" : "disjoint";
}

export function subtractWindows<Position>(
  left: Window<Position>,
  right: Window<Position>,
  compare: ComparePosition<Position>,
): WindowSet<Position> {
  const intersection = intersectWindows(left, right, compare);
  if (!intersection) return [left];

  const result: Window<Position>[] = [];
  if (compare(left.start, intersection.start) < 0) {
    result.push({ start: left.start, end: intersection.start });
  }
  if (compare(intersection.end, left.end) < 0) {
    result.push({ start: intersection.end, end: left.end });
  }
  return result;
}

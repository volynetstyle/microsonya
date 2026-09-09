import type { ChatMessage } from "@microsonya/shared";
import { compareChronologically } from "./chronology.js";

export interface RankedMessage {
  readonly message: ChatMessage;
  readonly ordinal: number;
}

export type SelectionDirection = "earliest" | "latest";

/**
 * Existing implementation relies on stable Array#sort.
 *
 * ordinal turns that implicit stability rule into an explicit total order,
 * allowing bounded heap selection to produce exactly the same result even
 * if two messages compare equal by time + id.
 */
export function compareRankedChronologically(
  left: RankedMessage,
  right: RankedMessage,
): number {
  return (
    compareChronologically(left.message, right.message) ||
    left.ordinal - right.ordinal
  );
}

function compareIncomingToRanked(
  message: ChatMessage,
  ordinal: number,
  right: RankedMessage,
): number {
  return (
    compareChronologically(message, right.message) || ordinal - right.ordinal
  );
}

/**
 * For "earliest", the heap root is the latest currently-selected message.
 * For "latest", the root is the earliest currently-selected message.
 *
 * In both cases the root is the element we would throw away first.
 */
export function heapifySelection(
  heap: RankedMessage[],
  direction: SelectionDirection,
): void {
  for (let index = (heap.length >>> 1) - 1; index >= 0; index--) {
    siftDownSelection(heap, index, direction);
  }
}

export function siftDownSelection(
  heap: RankedMessage[],
  startIndex: number,
  direction: SelectionDirection,
): void {
  const length = heap.length;
  let index = startIndex;

  while (true) {
    const left = index * 2 + 1;

    if (left >= length) {
      return;
    }

    const right = left + 1;

    let boundary = left;

    if (
      right < length &&
      boundaryPrecedes(heap[right]!, heap[left]!, direction)
    ) {
      boundary = right;
    }

    if (!boundaryPrecedes(heap[boundary]!, heap[index]!, direction)) {
      return;
    }

    const current = heap[index]!;
    heap[index] = heap[boundary]!;
    heap[boundary] = current;

    index = boundary;
  }
}

function boundaryPrecedes(
  left: RankedMessage,
  right: RankedMessage,
  direction: SelectionDirection,
): boolean {
  const comparison = compareRankedChronologically(left, right);

  return direction === "earliest" ? comparison > 0 : comparison < 0;
}

export function shouldReplaceBoundary(
  message: ChatMessage,
  ordinal: number,
  boundary: RankedMessage,
  direction: SelectionDirection,
): boolean {
  const comparison = compareIncomingToRanked(message, ordinal, boundary);

  return direction === "earliest" ? comparison < 0 : comparison > 0;
}

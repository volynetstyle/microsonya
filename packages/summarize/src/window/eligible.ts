import type { ChatMessage, MessageId } from "@microsonya/shared";
import type { RankedMessage, SelectionDirection } from "./ranking.js";
import {
  compareRankedChronologically,
  heapifySelection,
  shouldReplaceBoundary,
  siftDownSelection,
} from "./ranking.js";
import type { WindowConsumption } from "./selection.js";

/**
 * Selects only the K messages actually needed by the caller.
 *
 * checkpoint:
 *   keep chronologically earliest K messages.
 *
 * read-only:
 *   keep chronologically latest K messages.
 *
 * Unlike filter().sort().slice(), memory stays O(K) when the history is large.
 */
export function selectEligibleMessages(
  all: readonly ChatMessage[],
  upperExclusive: MessageId,
  checkpointBefore: MessageId | undefined,
  consumption: WindowConsumption,
  since: number,
  limit: number,
): ChatMessage[] {
  if (limit === 0) {
    return [];
  }

  const direction: SelectionDirection =
    consumption === "checkpoint" ? "earliest" : "latest";

  const selected: RankedMessage[] = [];

  let heapified = false;

  for (let ordinal = 0; ordinal < all.length; ordinal++) {
    const message = all[ordinal]!;

    if (message.id >= upperExclusive) {
      continue;
    }

    if (message.text.trim().length === 0) {
      continue;
    }

    if (consumption === "checkpoint") {
      if (checkpointBefore !== undefined && message.id <= checkpointBefore) {
        continue;
      }

      if (message.time < since) {
        continue;
      }
    }

    // Adaptive fast path:
    //
    // If eligible <= limit, this remains just an append-only array
    // followed by one final sort. No heap maintenance whatsoever.
    if (selected.length < limit) {
      selected.push({
        message,
        ordinal,
      });

      continue;
    }

    // We only pay heap construction once we have discovered that
    // there are actually more than K eligible messages.
    if (!heapified) {
      heapifySelection(selected, direction);
      heapified = true;
    }

    const boundary = selected[0]!;

    if (shouldReplaceBoundary(message, ordinal, boundary, direction)) {
      selected[0] = {
        message,
        ordinal,
      };

      siftDownSelection(selected, 0, direction);
    }
  }

  // Restore the exact stable chronological order expected by callers.
  selected.sort(compareRankedChronologically);

  const result = new Array<ChatMessage>(selected.length);

  for (let i = 0; i < selected.length; i++) {
    result[i] = selected[i]!.message;
  }

  return result;
}

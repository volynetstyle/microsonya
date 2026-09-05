import {
  createConversationWindow,
  type ChatMessage,
  type ConversationWindow,
  type MessageId,
  type SummaryCommand,
} from "@microsonya/shared";
import { DAY_MS, MAX_MESSAGES } from "../evaluation/policy.js";

/** Whether a selected window is allowed to advance the canonical checkpoint. */
export type WindowConsumption = "checkpoint" | "read-only";

export interface WindowMessage {
  readonly message: ChatMessage;
  readonly role: "eligible" | "context";
}

export interface SelectedConversation {
  readonly window: ConversationWindow;
  readonly messages: readonly WindowMessage[];
  readonly eligibleMessages: readonly ChatMessage[];
  readonly contextMessages: readonly ChatMessage[];
  readonly consumption: WindowConsumption;
  readonly checkpointBefore: MessageId | null;
  readonly consumptionUpperBound: MessageId | null;
  readonly upperExclusive: MessageId;
}

export interface SummaryWindowSelectionInput {
  readonly messages: readonly ChatMessage[];
  readonly command: SummaryCommand;
  readonly checkpointBefore?: MessageId;
}

/** Narrow replacement seam for selecting stored messages for one summary run. */
export interface SummaryWindowSelector {
  select(input: SummaryWindowSelectionInput): SelectedConversation | null;
}

/**
 * v0.1 policy:
 *
 * - pending/today consumes the oldest eligible prefix;
 * - explicit count reads the newest historical suffix;
 * - reply parents are context only;
 * - count never advances the canonical checkpoint.
 */
export const pendingSummaryWindowSelector: SummaryWindowSelector =
  Object.freeze({
    select: selectSummaryWindow,
  });

interface RankedMessage {
  readonly message: ChatMessage;
  readonly ordinal: number;
}

type SelectionDirection = "earliest" | "latest";

export function selectSummaryWindow(
  input: SummaryWindowSelectionInput,
): SelectedConversation | null {
  const { messages: all, command, checkpointBefore } = input;

  const isCount = command.mode === "count";

  const consumption: WindowConsumption = isCount ? "read-only" : "checkpoint";

  // Preserve the current process-local day-boundary policy exactly.
  const since =
    command.mode === "today"
      ? new Date(command.date).setHours(0, 0, 0, 0)
      : command.date - DAY_MS;

  // Explicit `/summary N` is a read-only request, never an authorization to
  // construct an unbounded model prompt.  Applying the same cap to retries is
  // crucial: already queued legacy jobs may carry a larger requested count.
  const rawLimit = isCount
    ? Math.min(MAX_MESSAGES, Math.max(1, command.count ?? 100))
    : MAX_MESSAGES;

  const limit = normalizeSelectionLimit(rawLimit, consumption);

  const eligibleMessages = selectEligibleMessages(
    all,
    command.commandMessageId,
    checkpointBefore,
    consumption,
    since,
    limit,
  );

  if (eligibleMessages.length === 0) {
    return null;
  }

  const selectedIds = new Set<MessageId>();
  const neededParentIds = new Set<MessageId>();

  for (let i = 0; i < eligibleMessages.length; i++) {
    selectedIds.add(eligibleMessages[i]!.id);
  }

  for (let i = 0; i < eligibleMessages.length; i++) {
    const parentId = eligibleMessages[i]!.parentId;

    if (parentId !== null && !selectedIds.has(parentId)) {
      neededParentIds.add(parentId);
    }
  }

  const contextMessages = selectContextMessages(all, neededParentIds);

  // Both inputs are already chronological.
  // Stable merge is equivalent to:
  //
  // [...contextMessages, ...eligibleMessages].sort(compareChronologically)
  //
  // including the original "context wins ties" behavior.
  const windowMessages = mergeChronologically(
    contextMessages,
    eligibleMessages,
  );

  const messages = Object.freeze(
    windowMessages.map((message) =>
      Object.freeze({
        message,
        role: neededParentIds.has(message.id)
          ? ("context" as const)
          : ("eligible" as const),
      }),
    ),
  );

  const frozenEligibleMessages = Object.freeze(eligibleMessages);
  const frozenContextMessages = Object.freeze(contextMessages);

  return Object.freeze({
    window: createConversationWindow(windowMessages),
    messages,
    eligibleMessages: frozenEligibleMessages,
    contextMessages: frozenContextMessages,
    consumption,
    checkpointBefore: checkpointBefore ?? null,
    consumptionUpperBound:
      consumption === "checkpoint"
        ? eligibleMessages[eligibleMessages.length - 1]!.id
        : (checkpointBefore ?? null),
    upperExclusive: command.commandMessageId,
  });
}

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
function selectEligibleMessages(
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

/**
 * Finds reply-parent context after the final eligible set is known.
 *
 * Keeping this as a second linear scan avoids constructing a full
 * MessageId -> message index for histories where only a handful of
 * reply parents are needed.
 */
function selectContextMessages(
  all: readonly ChatMessage[],
  neededParentIds: ReadonlySet<MessageId>,
): ChatMessage[] {
  if (neededParentIds.size === 0) {
    return [];
  }

  const context: ChatMessage[] = [];

  for (let i = 0; i < all.length; i++) {
    const message = all[i]!;

    if (neededParentIds.has(message.id)) {
      context.push(message);
    }
  }

  context.sort(compareChronologically);

  return context;
}

/**
 * Stable merge of two chronological sequences.
 *
 * On equality, left/context is selected first because the old code
 * constructed:
 *
 *   [...contextMessages, ...eligibleMessages]
 *
 * before its stable sort.
 */
function mergeChronologically(
  context: readonly ChatMessage[],
  eligible: readonly ChatMessage[],
): ChatMessage[] {
  if (context.length === 0) {
    return eligible.slice();
  }

  if (eligible.length === 0) {
    return context.slice();
  }

  const merged = new Array<ChatMessage>(context.length + eligible.length);

  let contextIndex = 0;
  let eligibleIndex = 0;
  let outputIndex = 0;

  while (contextIndex < context.length && eligibleIndex < eligible.length) {
    const contextMessage = context[contextIndex]!;
    const eligibleMessage = eligible[eligibleIndex]!;

    if (compareChronologically(contextMessage, eligibleMessage) <= 0) {
      merged[outputIndex++] = contextMessage;
      contextIndex++;
    } else {
      merged[outputIndex++] = eligibleMessage;
      eligibleIndex++;
    }
  }

  while (contextIndex < context.length) {
    merged[outputIndex++] = context[contextIndex++]!;
  }

  while (eligibleIndex < eligible.length) {
    merged[outputIndex++] = eligible[eligibleIndex++]!;
  }

  return merged;
}

/**
 * Existing implementation relies on stable Array#sort.
 *
 * ordinal turns that implicit stability rule into an explicit total order,
 * allowing bounded heap selection to produce exactly the same result even
 * if two messages compare equal by time + id.
 */
function compareRankedChronologically(
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
function heapifySelection(
  heap: RankedMessage[],
  direction: SelectionDirection,
): void {
  for (let index = (heap.length >>> 1) - 1; index >= 0; index--) {
    siftDownSelection(heap, index, direction);
  }
}

function siftDownSelection(
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

function shouldReplaceBoundary(
  message: ChatMessage,
  ordinal: number,
  boundary: RankedMessage,
  direction: SelectionDirection,
): boolean {
  const comparison = compareIncomingToRanked(message, ordinal, boundary);

  return direction === "earliest" ? comparison < 0 : comparison > 0;
}

/**
 * Array#slice performs ToIntegerOrInfinity internally.
 *
 * Normal commands are positive integers, but preserving these edge cases
 * makes this genuinely semantics-compatible with the previous code:
 *
 * checkpoint + NaN:
 *   sorted.slice(0, NaN) -> []
 *
 * count + NaN:
 *   sorted.slice(-NaN) -> sorted.slice(0) -> all
 */
function normalizeSelectionLimit(
  rawLimit: number,
  consumption: WindowConsumption,
): number {
  if (Number.isNaN(rawLimit)) {
    return consumption === "checkpoint" ? 0 : Number.POSITIVE_INFINITY;
  }

  if (!Number.isFinite(rawLimit)) {
    return rawLimit;
  }

  return Math.trunc(rawLimit);
}

/** Legacy-compatible helper; count uses the same read-only history policy. */
export function selectMessages(
  all: readonly ChatMessage[],
  command: SummaryCommand,
  lastId?: MessageId,
): ChatMessage[] {
  return (
    selectSummaryWindow({
      messages: all,
      command,
      checkpointBefore: lastId,
    })?.eligibleMessages.slice() ?? []
  );
}

export function selectConversationWindow(
  all: readonly ChatMessage[],
  command: SummaryCommand,
  lastId?: MessageId,
): SelectedConversation | null {
  return selectSummaryWindow({
    messages: all,
    command,
    checkpointBefore: lastId,
  });
}

function compareChronologically(left: ChatMessage, right: ChatMessage): number {
  return left.time - right.time || left.id - right.id;
}

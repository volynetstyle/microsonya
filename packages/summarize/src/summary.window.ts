import type { MessageId } from "@microsonya/shared";
import { createConversationWindow } from "@microsonya/shared";
import { mergeChronologically } from "./window/chronology.js";
import { selectContextMessages } from "./window/context.js";
import { selectEligibleMessages } from "./window/eligible.js";
import { DAY_MS, MAX_MESSAGES } from "./window/limits.js";
import type {
  SelectedConversation,
  SummaryWindowSelectionInput,
  SummaryWindowSelector,
  WindowConsumption,
} from "./window/selection.js";

/**
 * Recent commands consume the oldest eligible prefix. Historical commands
 * read the newest suffix; reply parents are context and never advance coverage.
 */
export const defaultSummaryWindowSelector: SummaryWindowSelector = {
  select: selectSummaryWindow,
};

export function selectSummaryWindow(
  input: SummaryWindowSelectionInput,
): SelectedConversation | null {
  const { messages: all, command, checkpointBefore } = input;

  const isCount = command.mode === "count";

  // Only a bare /summary is catch-up. Historical queries never authorize a
  // cursor transition, even when they happen to resolve to the same window.
  const consumption: WindowConsumption =
    command.mode === "recent" ? "checkpoint" : "read-only";

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

  const messages = windowMessages.map((message) => ({
    message,
    role: neededParentIds.has(message.id)
      ? ("context" as const)
      : ("eligible" as const),
  }));

  return {
    window: createConversationWindow(windowMessages),
    messages,
    eligibleMessages,
    contextMessages,
    consumption,
    checkpointBefore: checkpointBefore ?? null,
    consumptionUpperBound:
      consumption === "checkpoint"
        ? eligibleMessages[eligibleMessages.length - 1]!.id
        : (checkpointBefore ?? null),
    upperExclusive: command.commandMessageId,
  };
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

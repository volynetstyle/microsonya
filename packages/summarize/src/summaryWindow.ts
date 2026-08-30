import {
  createConversationWindow,
  type ChatMessage,
  type ConversationWindow,
  type MessageId,
  type SummaryCommand,
} from "@microsonya/shared";
import { DAY_MS, MAX_MESSAGES } from "./constants.js";

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
  readonly checkpointCandidate: MessageId | null;
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

/** The v0.1 policy: pending messages consume a prefix; explicit counts are history. */
export const pendingSummaryWindowSelector: SummaryWindowSelector =
  Object.freeze({
    select: selectSummaryWindow,
  });

export function selectSummaryWindow(
  input: SummaryWindowSelectionInput,
): SelectedConversation | null {
  const { messages: all, command, checkpointBefore } = input;
  const consumption: WindowConsumption =
    command.mode === "count" ? "read-only" : "checkpoint";
  // v0.1 retains the process-local day boundary; selector injection is the
  // deliberate seam for a future chat-local timezone policy.
  const since =
    command.mode === "today"
      ? new Date(command.date).setHours(0, 0, 0, 0)
      : command.date - DAY_MS;
  const eligible = all
    .filter(
      (message) =>
        message.id < command.commandMessageId &&
        message.text.trim().length > 0 &&
        (consumption === "read-only" ||
          checkpointBefore === undefined ||
          message.id > checkpointBefore) &&
        (command.mode === "count" || message.time >= since),
    )
    .sort(compareChronologically);

  const limit =
    command.mode === "count" ? Math.max(1, command.count ?? 100) : MAX_MESSAGES;
  // Canonical work must cover a prefix so checkpoint advancement cannot skip a gap.
  const eligibleMessages =
    eligible.length <= limit
      ? eligible
      : consumption === "checkpoint"
        ? eligible.slice(0, limit)
        : eligible.slice(-limit);
  if (eligibleMessages.length === 0) return null;

  const selectedIds = new Set(eligibleMessages.map(({ id }) => id));
  const neededParentIds = new Set<MessageId>();
  for (const { parentId } of eligibleMessages) {
    if (parentId !== null && !selectedIds.has(parentId))
      neededParentIds.add(parentId);
  }
  const contextMessages = all
    .filter(({ id }) => neededParentIds.has(id))
    .sort(compareChronologically);
  const windowMessages = [...contextMessages, ...eligibleMessages].sort(
    compareChronologically,
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
  return Object.freeze({
    window: createConversationWindow(windowMessages),
    messages,
    eligibleMessages: Object.freeze(eligibleMessages),
    contextMessages: Object.freeze(contextMessages),
    consumption,
    checkpointBefore: checkpointBefore ?? null,
    checkpointCandidate:
      consumption === "checkpoint"
        ? eligibleMessages.at(-1)!.id
        : (checkpointBefore ?? null),
    upperExclusive: command.commandMessageId,
  });
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

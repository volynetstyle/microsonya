import type {
  ChatMessage,
  ConversationWindow,
  MessageId,
  SummaryCommand,
} from "@microsonya/shared";

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

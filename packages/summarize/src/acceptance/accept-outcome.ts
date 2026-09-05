import type {
  AcceptedOutcomeRecord,
  ChatMessage,
  SummaryCommand,
  SummaryId,
  TimestampMs,
  WindowDisposition,
} from "@microsonya/shared";
import type { SelectedConversation } from "../selection/select-conversation.js";
import { presentDisposition } from "../presentation/present-outcome.js";

export function acceptOutcome(input: {
  readonly selected: SelectedConversation;
  readonly command: SummaryCommand;
  readonly action: AcceptedOutcomeRecord["action"];
  readonly disposition: Exclude<WindowDisposition, { kind: "deferred" }>;
  readonly createSummaryId: () => SummaryId;
  readonly now: () => TimestampMs;
}): AcceptedOutcomeRecord {
  const { selected, command, action, disposition } = input;
  if (disposition.kind === "summarized") {
    return Object.freeze({
      id: disposition.summary.id,
      chatId: disposition.summary.chatId,
      commandMessageId: command.commandMessageId,
      createdAt: disposition.summary.createdAt,
      covers: disposition.summary.covers,
      mode: command.mode,
      status: "summarized",
      action,
      finalText: disposition.summary.text,
    });
  }

  return Object.freeze({
    id: input.createSummaryId(),
    chatId: selected.window.chatId,
    commandMessageId: command.commandMessageId,
    createdAt: input.now(),
    covers: coverageOf(selected.eligibleMessages),
    mode: command.mode,
    status: "skipped",
    action,
    finalText: presentDisposition(disposition),
  });
}

function coverageOf(messages: readonly ChatMessage[]) {
  return Object.freeze({
    firstId: messages[0]!.id,
    lastId: messages.at(-1)!.id,
    count: messages.length,
  });
}

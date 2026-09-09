import type {
  AcceptedOutcomeRecord,
  SummaryCommand,
  SummaryId,
  TimestampMs,
  WindowDisposition,
} from "@microsonya/shared";
import { presentDisposition } from "./summary.presentation.js";
import { coverageOf } from "./window/coverage.js";
import type { SelectedConversation } from "./window/selection.js";

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
    return {
      id: disposition.summary.id,
      chatId: disposition.summary.chatId,
      commandMessageId: command.commandMessageId,
      createdAt: disposition.summary.createdAt,
      covers: disposition.summary.covers,
      mode: command.mode,
      status: "summarized",
      action,
      finalText: disposition.summary.text,
    };
  }

  return {
    id: input.createSummaryId(),
    chatId: selected.window.chatId,
    commandMessageId: command.commandMessageId,
    createdAt: input.now(),
    covers: coverageOf(selected.eligibleMessages),
    mode: command.mode,
    status: "skipped",
    action,
    finalText: presentDisposition(disposition),
  };
}

import { randomUUID } from "node:crypto";
import type {
  ChatMessage,
  SummaryCommand,
  SummaryRun,
} from "@microsonya/shared";
import type { SummaryWaterfall } from "../observability/waterfall.js";
import type { SummaryRunsRepo } from "./types.js";

export async function persistSummaryRun(
  summaries: SummaryRunsRepo,
  command: SummaryCommand,
  messages: readonly ChatMessage[],
  finalText: string,
  trace: SummaryWaterfall,
): Promise<void> {
  const run: SummaryRun = {
    id: randomUUID(),
    chatId: command.chatId,
    commandMessageId: command.commandMessageId,
    createdAt: Date.now(),
    fromMessageId: messages[0]!.id,
    toMessageId: messages.at(-1)!.id,
    mode: command.mode,
    status: "ok",
    finalText,
  };
  await trace.span("summary.persist", {}, () => summaries.saveRun(run));
}

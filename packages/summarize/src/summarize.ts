import { randomUUID } from "node:crypto";
import type { MessagesRepo, SummariesRepo } from "@microsonya/db";
import type { ModelGateway } from "@microsonya/model-gateway";
import type { SummaryCommand, SummaryRun } from "@microsonya/shared";
import { hashMessages } from "./hashMessages.js";
import { buildMergePrompt, buildSegmentPrompt } from "./prompts.js";
import { segmentMessages } from "./segmentMessages.js";
import { selectSummaryWindow } from "./selectWindow.js";

export type SummarizeRuntimeDeps = {
  messages: MessagesRepo;
  summaries: SummariesRepo;
  models: ModelGateway;
};

export async function summarize(deps: SummarizeRuntimeDeps, command: SummaryCommand): Promise<string> {
  const messages = selectSummaryWindow(
    command,
    await deps.messages.listByChat(command.chatId),
    await deps.summaries.findLastRun(command.chatId)
  );

  if (messages.length === 0) {
    return "Немає нових повідомлень для підсумку.";
  }

  const segments = segmentMessages(messages);
  const segmentSummaries = [];

  for (const segment of segments) {
    const hash = hashMessages(segment.messages);
    const cached = await deps.summaries.findCachedSegment(segment.chatId, segment.fromMessageId, segment.toMessageId, hash);

    if (cached) {
      segmentSummaries.push(cached);
      continue;
    }

    const summary = await deps.models.summarizeSegment(segment, hash, buildSegmentPrompt(segment));
    await deps.summaries.saveSegment(summary);
    segmentSummaries.push(summary);
  }

  const finalSummary = await deps.models.mergeSummaries(segmentSummaries, buildMergePrompt(segmentSummaries));
  const first = messages[0];
  const last = messages.at(-1);

  if (!first || !last) {
    return "Немає нових повідомлень для підсумку.";
  }

  const run: SummaryRun = {
    id: randomUUID(),
    chatId: command.chatId,
    commandMessageId: command.commandMessageId,
    createdAt: Date.now(),
    fromMessageId: first.id,
    toMessageId: last.id,
    mode: command.mode,
    status: "ok",
    finalText: finalSummary.text
  };

  await deps.summaries.saveRun(run);
  return finalSummary.text;
}

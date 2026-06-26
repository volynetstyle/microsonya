import { randomUUID } from "node:crypto";
import type { MessagesRepo, SummariesRepo } from "@microsonya/db";
import type { ModelGateway } from "@microsonya/model-gateway";
import type {
  SegmentSummary,
  SummaryCommand,
  SummaryRun,
} from "@microsonya/shared";
import { hashMessages } from "./hashMessages.js";
import { buildSegmentPrompt } from "./prompts.js";
import { segmentMessages } from "./segmentMessages.js";
import { selectSummaryWindow } from "./selectWindow.js";

export type SummarizeRuntimeDeps = {
  messages: MessagesRepo;
  summaries: SummariesRepo;
  models: ModelGateway;
};

const pendingSegmentSummaries = new Map<string, Promise<unknown>>();

export async function summarize(
  deps: SummarizeRuntimeDeps,
  command: SummaryCommand,
): Promise<string> {
  const messages = selectSummaryWindow(
    command,
    await deps.messages.listByChat(command.chatId),
    await deps.summaries.findLastRun(command.chatId),
  );

  if (messages.length === 0) {
    return "Немає нових повідомлень для підсумку.";
  }

  const segments = segmentMessages(messages);
  const segmentSummaries = [];

  for (const segment of segments) {
    const hash = hashMessages(segment.messages);
    const cached = await deps.summaries.findCachedSegment(
      segment.chatId,
      segment.fromMessageId,
      segment.toMessageId,
      hash,
    );

    if (cached) {
      segmentSummaries.push(cached);
      continue;
    }

    const summary = await summarizeOnce(`${segment.id}:${hash}`, () =>
      deps.models.summarizeSegment(segment, hash, buildSegmentPrompt(segment)),
    );
    await deps.summaries.saveSegment(summary);
    segmentSummaries.push(summary);
  }

  const finalText = renderFinalSummary(segmentSummaries);
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
    finalText,
  };

  await deps.summaries.saveRun(run);
  return finalText;
}

async function summarizeOnce<T>(
  key: string,
  run: () => Promise<T>,
): Promise<T> {
  const existing = pendingSegmentSummaries.get(key) as Promise<T> | undefined;

  if (existing) {
    return existing;
  }

  const promise = run().finally(() => {
    pendingSegmentSummaries.delete(key);
  });

  pendingSegmentSummaries.set(key, promise);

  return promise;
}

function renderFinalSummary(summaries: SegmentSummary[]): string {
  const title =
    summaries.find((summary) => summary.importance > 0)?.title ||
    summaries[0]?.title ||
    "Підсумок";
  const facts = uniqueFlatMap(summaries, (summary) => summary.summary).slice(
    0,
    8,
  );
  const decisions = uniqueFlatMap(
    summaries,
    (summary) => summary.decisions,
  ).slice(0, 5);
  const questions = uniqueFlatMap(
    summaries,
    (summary) => summary.openQuestions,
  ).slice(0, 5);

  return [
    title,
    "",
    ...formatSection(facts),
    "",
    "Рішення:",
    ...formatSection(decisions, "Рішень не зафіксовано."),
    "",
    "Відкриті питання:",
    ...formatSection(questions, "Відкритих питань не зафіксовано."),
  ]
    .join("\n")
    .trim();
}

function uniqueFlatMap(
  summaries: SegmentSummary[],
  select: (summary: SegmentSummary) => string[],
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of summaries.flatMap(select)) {
    const normalized = item.trim();

    if (normalized && !seen.has(normalized.toLocaleLowerCase())) {
      seen.add(normalized.toLocaleLowerCase());
      result.push(normalized);
    }
  }

  return result;
}

function formatSection(items: string[], empty = "Немає даних."): string[] {
  if (items.length === 0) {
    return [`• ${empty}`];
  }

  return items.map((item) => `• ${item}`);
}

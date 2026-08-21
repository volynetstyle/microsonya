import { randomUUID } from "node:crypto";
import type { MessagesRepo, SummariesRepo } from "@microsonya/db";
import type { Model } from "@microsonya/model";
import type {
  ChatMessage,
  SummaryCommand,
  SummaryRun,
} from "@microsonya/shared";
import { z } from "zod";
import type { SummarizationTelemetryService } from "./telemetry.js";

const outputSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
});

export type Summarizer = {
  summarize(
    command: SummaryCommand,
    signal?: AbortSignal,
  ): Promise<string | null>;
};
export type SummarizerDeps = {
  messages: Pick<MessagesRepo, "listByChat">;
  summaries: Pick<SummariesRepo, "findLastRun" | "saveRun">;
  model: Model;
  telemetry?: SummarizationTelemetryService;
};

export function createSummarizer(deps: SummarizerDeps): Summarizer {
  return { summarize: (command, signal) => run(deps, command, signal) };
}

async function run(
  deps: SummarizerDeps,
  command: SummaryCommand,
  signal?: AbortSignal,
): Promise<string | null> {
  const startedAt = performance.now();
  try {
    signal?.throwIfAborted();
    const [all, previous] = await Promise.all([
      deps.messages.listByChat(command.chatId),
      deps.summaries.findLastRun(command.chatId),
    ]);
    const messages = selectMessages(all, command, previous?.toMessageId);
    if (!messages.length) return null;
    const result = await deps.model.generate(
      buildPrompt(messages),
      outputSchema,
      { signal, maxOutputTokens: 2_500 },
    );
    await saveRun(deps.summaries, command, messages, result.summary);
    deps.telemetry?.record({
      chatId: command.chatId,
      commandMessageId: command.commandMessageId,
      messageCount: messages.length,
      durationMs: performance.now() - startedAt,
      status: "ok",
    });
    return result.summary;
  } catch (error) {
    deps.telemetry?.record({
      chatId: command.chatId,
      commandMessageId: command.commandMessageId,
      durationMs: performance.now() - startedAt,
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

function selectMessages(
  all: readonly ChatMessage[],
  command: SummaryCommand,
  lastId?: number,
): ChatMessage[] {
  const messages = all.filter(
    (m) =>
      m.id !== command.commandMessageId &&
      !m.isCommand &&
      m.kind === "text" &&
      m.text.trim() &&
      m.id > (lastId ?? -1),
  );
  if (command.mode === "count")
    return messages.slice(-Math.max(1, command.count ?? 100));
  const since =
    command.mode === "today"
      ? new Date(command.date).setHours(0, 0, 0, 0)
      : command.date - 86_400_000;
  return messages.filter((m) => m.date >= since).slice(-1024);
}

function buildPrompt(messages: readonly ChatMessage[]): string {
  const transcript = messages
    .map((m) => `[${m.id}] ${m.authorName || m.authorId}: ${m.text}`)
    .join("\n");
  return [
    "Summarize this Telegram conversation in natural Ukrainian.",
    "Preserve attribution, decisions, unresolved questions, important facts, numbers, negation, and uncertainty.",
    "Remove greetings, repetition, jokes, and minor tangents unless they affect the outcome.",
    "Do not invent facts or causal links. Return JSON only with title and summary fields.",
    "Messages:",
    transcript,
  ].join("\n\n");
}

async function saveRun(
  summaries: SummarizerDeps["summaries"],
  command: SummaryCommand,
  messages: readonly ChatMessage[],
  finalText: string,
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
  await summaries.saveRun(run);
}

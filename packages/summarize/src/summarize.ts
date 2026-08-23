import { randomUUID } from "node:crypto";
import type { MessagesRepo, SummariesRepo } from "@microsonya/db";
import type { Model } from "@microsonya/model";
import type {
  ChatMessage,
  SummaryCommand,
  SummaryRun,
} from "@microsonya/shared";
import type { SummarizationTelemetryService } from "./telemetry.js";
import {
  outputSchema,
  DAY_MS,
  MAX_MESSAGES,
  SUMMARY_INSTRUCTIONS,
} from "./constants.js";
import { encodePipe, PIPE_GUIDE } from "./pipe.js";

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
  return {
    summarize: (command, signal) => run(deps, command, signal),
  };
}

async function run(
  deps: SummarizerDeps,
  command: SummaryCommand,
  signal?: AbortSignal,
): Promise<string | null> {
  const startedAt = performance.now();

  const telemetry = deps.telemetry?.start({
    traceId: `${command.chatId}:${command.commandMessageId}:${randomUUID()}`,
    chatId: command.chatId,
    commandMessageId: command.commandMessageId,
  });

  let stage = "start";

  try {
    telemetry?.record({
      type: "summary.start",
      mode: command.mode,
    });

    signal?.throwIfAborted();

    stage = "messages.load";

    const [all, previous] = await Promise.all([
      deps.messages.listByChat(command.chatId),
      deps.summaries.findLastRun(command.chatId),
    ]);

    telemetry?.record({
      type: "messages.loaded",
      messageCount: all.length,
      hasPreviousRun: previous !== undefined,
    });

    signal?.throwIfAborted();

    stage = "messages.select";

    const messages = selectMessages(all, command, previous?.toMessageId);

    telemetry?.record({
      type: "messages.selected",
      messageCount: messages.length,
      fromMessageId: messages[0]?.id,
      toMessageId: messages.at(-1)?.id,
    });

    if (messages.length === 0) {
      telemetry?.record({
        type: "summary.finish",
        durationMs: performance.now() - startedAt,
        status: "empty",
      });

      return null;
    }

    stage = "model.generate";

    const prompt = buildPrompt(messages);

    telemetry?.record({
      type: "model.request",
      messageCount: messages.length,
      promptChars: prompt.length,
      prompt,
    });

    const modelStartedAt = performance.now();

    const { summary } = await deps.model.generate(prompt, outputSchema, {
      signal,
      maxOutputTokens: 2_500,
    });

    telemetry?.record({
      type: "model.response",
      durationMs: performance.now() - modelStartedAt,
      summaryChars: summary.length,
    });

    signal?.throwIfAborted();

    stage = "summary.save";

    const saveStartedAt = performance.now();

    await saveRun(deps.summaries, command, messages, summary);

    telemetry?.record({
      type: "summary.saved",
      durationMs: performance.now() - saveStartedAt,
    });

    telemetry?.record({
      type: "summary.finish",
      durationMs: performance.now() - startedAt,
      status: "ok",
    });

    return summary;
  } catch (error) {
    telemetry?.record({
      type: "summary.error",
      durationMs: performance.now() - startedAt,
      stage,
      error: serializeError(error),
    });

    throw error;
  }
}

function serializeError(error: unknown): {
  name?: string;
  message: string;
  stack?: string;
} {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    message: String(error),
  };
}

export function selectMessages(
  all: readonly ChatMessage[],
  command: SummaryCommand,
  lastId?: number,
): ChatMessage[] {
  const afterId = lastId ?? -1;

  const eligible = all.filter(
    (message) =>
      message.id !== command.commandMessageId &&
      message.id > afterId &&
      !message.isCommand &&
      message.kind === "text" &&
      message.text.trim().length > 0,
  );

  if (command.mode === "count") {
    const count = Math.max(1, command.count ?? 100);
    return eligible.slice(-count);
  }

  const since =
    command.mode === "today"
      ? new Date(command.date).setHours(0, 0, 0, 0)
      : command.date - DAY_MS;

  return eligible
    .filter((message) => message.date >= since)
    .slice(-MAX_MESSAGES);
}

export function buildPrompt(messages: readonly ChatMessage[]): string {
  return [
    section("SUMMARY_POLICY", SUMMARY_INSTRUCTIONS),
    section("TRANSCRIPT_FORMAT", PIPE_GUIDE),
    section("VISIBLE_MESSAGES", encodePipe(messages)),
  ].join("\n\n");
}

function section(name: string, content: string): string {
  return [`${name}_BEGIN`, content, `${name}_END`].join("\n");
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

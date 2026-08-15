import { randomUUID } from "node:crypto";
import type { MessagesRepo, SummariesRepo } from "@microsonya/db";
import type { ModelGateway } from "@microsonya/model-gateway";
import type {
  MemoryState,
  SummaryCommand,
  SummaryRun,
} from "@microsonya/shared";
import { hashMessages } from "./hashMessages.js";
import { processChatDelta } from "./memoryRuntime.js";
import { createMemoryState } from "./memoryState.js";
import { buildSegmentPrompt } from "./prompts.js";
import { renderSummary } from "./renderSummary.js";
import { segmentMessages } from "./segmentMessages.js";
import { selectSummaryWindow } from "./selectWindow.js";
import { SummaryWaterfall, type SummaryWaterfallSink } from "./waterfall.js";

export type SummaryMessagesRepo = Pick<
  MessagesRepo,
  "listAfterByChat" | "listByChat"
>;
export type SummaryRunsRepo = Pick<
  SummariesRepo,
  "findCachedReconstruction" | "findLastRun" | "saveRun" | "saveReconstruction"
>;
export type SummaryModels = Pick<ModelGateway, "reconstructSegment"> &
  Partial<Pick<ModelGateway, "extractMemoryOps">>;
export type MemoryModels = Pick<ModelGateway, "extractMemoryOps">;
export type MemoryStateRepo = {
  findState(chatId: string): Promise<MemoryState | undefined>;
  saveState(state: MemoryState, expectedVersion: number): Promise<boolean>;
};

export type SummarizeRuntimeDeps = {
  memory: MemoryStateRepo;
  messages: SummaryMessagesRepo;
  summaries: SummaryRunsRepo;
  models: SummaryModels;
  memoryModels?: MemoryModels;
  onTrace?: SummaryWaterfallSink;
  segmentConcurrency?: number;
  signal?: AbortSignal;
};

const pendingReconstructions = new Map<string, Promise<unknown>>();
const pendingMemoryUpdates = new Map<string, Promise<void>>();
const MEMORY_DELTA_BATCH_SIZE = 100;
const MAX_MEMORY_SAVE_CONFLICTS = 3;
const RECONSTRUCTION_SCHEMA_VERSION = 5;
const MIN_RECONSTRUCTION_OUTPUT_TOKENS = 2_048;
const MAX_RECONSTRUCTION_OUTPUT_TOKENS = 8_192;
const RECONSTRUCTION_OUTPUT_TOKENS_PER_MESSAGE = 320;
export const DEFAULT_SEGMENT_CONCURRENCY = 3;

export async function summarize(
  deps: SummarizeRuntimeDeps,
  command: SummaryCommand,
): Promise<string> {
  const trace = new SummaryWaterfall(
    command.chatId,
    command.commandMessageId,
    deps.onTrace,
  );

  try {
    return await summarizeCriticalPath(deps, command, trace);
  } finally {
    schedulePersistentMemoryUpdate(deps, command, trace);
  }
}

async function summarizeCriticalPath(
  deps: SummarizeRuntimeDeps,
  command: SummaryCommand,
  trace: SummaryWaterfall,
): Promise<string> {
  deps.signal?.throwIfAborted();
  const [allMessages, lastRun] = await Promise.all([
    trace.span("window.messages.load", {}, () =>
      deps.messages.listByChat(command.chatId),
    ),
    trace.span("window.last-run.load", {}, () =>
      deps.summaries.findLastRun(command.chatId),
    ),
  ]);
  const messages = await trace.span(
    "window.select",
    { messageCount: allMessages.length },
    () => selectSummaryWindow(command, allMessages, lastRun),
  );

  if (messages.length === 0) {
    trace.event("summary.empty");
    return "Немає нових повідомлень для підсумку.";
  }

  const segments = await trace.span(
    "segments.plan",
    { messageCount: messages.length },
    () => segmentMessages(messages),
  );
  trace.event("segments.planned", {
    messageCount: messages.length,
    segmentCount: segments.length,
  });
  let completedSegments = 0;
  const reconstructions = await mapWithConcurrency(
    segments,
    deps.segmentConcurrency ?? DEFAULT_SEGMENT_CONCURRENCY,
    async (segment) => {
      deps.signal?.throwIfAborted();
      const hash = hashMessages(segment.messages);
      const cached = await trace.span(
        "segment.cache.lookup",
        { segmentId: segment.id, messageCount: segment.messageCount },
        () =>
          deps.summaries.findCachedReconstruction(
            segment.chatId,
            segment.fromMessageId,
            segment.toMessageId,
            hash,
            RECONSTRUCTION_SCHEMA_VERSION,
          ),
      );
      trace.event("segment.cache", {
        segmentId: segment.id,
        messageCount: segment.messageCount,
        cacheStatus: cached ? "hit" : "miss",
      });
      if (cached) {
        completedSegments += 1;
        trace.event("segment.complete", {
          segmentId: segment.id,
          completedSegments,
          segmentCount: segments.length,
          cacheStatus: "hit",
        });
        return cached;
      }

      const prompt = await trace.span(
        "segment.prompt",
        { segmentId: segment.id, messageCount: segment.messageCount },
        () => buildSegmentPrompt(segment),
      );
      const reconstruction = await trace.span(
        "segment.model",
        {
          segmentId: segment.id,
          messageCount: segment.messageCount,
          promptChars: prompt.length,
        },
        () =>
          summarizeOnce(`${segment.id}:${hash}`, () =>
            deps.models.reconstructSegment(
              segment,
              hash,
              prompt,
              {
                operation: "segment-summary",
                chatId: command.chatId,
                commandMessageId: command.commandMessageId,
                segmentId: segment.id,
                maxOutputTokens: reconstructionOutputTokenBudget(
                  segment.messageCount,
                ),
              },
              deps.signal,
            ),
          ),
      );
      await trace.span("segment.persist", { segmentId: segment.id }, () =>
        deps.summaries.saveReconstruction(
          reconstruction,
          RECONSTRUCTION_SCHEMA_VERSION,
        ),
      );
      completedSegments += 1;
      trace.event("segment.complete", {
        segmentId: segment.id,
        completedSegments,
        segmentCount: segments.length,
      });
      return reconstruction;
    },
  );

  const finalText = await trace.span(
    "summary.render",
    { segmentCount: reconstructions.length },
    () => renderSummary(reconstructions),
  );
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

  await trace.span("summary.persist", {}, () => deps.summaries.saveRun(run));
  trace.event("summary.complete", {
    messageCount: messages.length,
    segmentCount: reconstructions.length,
  });
  return finalText;
}

export function reconstructionOutputTokenBudget(messageCount: number): number {
  return Math.min(
    MAX_RECONSTRUCTION_OUTPUT_TOKENS,
    Math.max(
      MIN_RECONSTRUCTION_OUTPUT_TOKENS,
      512 +
        Math.max(0, Math.floor(messageCount)) *
          RECONSTRUCTION_OUTPUT_TOKENS_PER_MESSAGE,
    ),
  );
}

function schedulePersistentMemoryUpdate(
  deps: SummarizeRuntimeDeps,
  command: SummaryCommand,
  trace: SummaryWaterfall,
): void {
  const model = deps.memoryModels ?? deps.models;
  if (typeof model.extractMemoryOps !== "function") {
    trace.event("memory.skipped", { error: "No memory model configured" });
    return;
  }

  const previous =
    pendingMemoryUpdates.get(command.chatId) ?? Promise.resolve();
  const current = previous
    .catch(() => undefined)
    .then(waitForNextEventLoopTurn)
    .then(() =>
      processAndSaveMemoryDeltas(deps, model as MemoryModels, command, trace),
    )
    .catch((error) => {
      trace.event("memory.background", {
        error: error instanceof Error ? error.message : String(error),
      });
    });

  pendingMemoryUpdates.set(command.chatId, current);
  void current.finally(() => {
    if (pendingMemoryUpdates.get(command.chatId) === current) {
      pendingMemoryUpdates.delete(command.chatId);
    }
  });
}

export async function waitForMemoryIdle(chatId: string): Promise<void> {
  await pendingMemoryUpdates.get(chatId);
}

function waitForNextEventLoopTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function processAndSaveMemoryDeltas(
  deps: SummarizeRuntimeDeps,
  model: MemoryModels,
  command: Pick<SummaryCommand, "chatId" | "commandMessageId">,
  trace: SummaryWaterfall,
): Promise<void> {
  let saveConflicts = 0;
  let memoryBatch = 0;

  while (true) {
    memoryBatch += 1;
    const previousState =
      (await trace.span("memory.state.load", { memoryBatch }, () =>
        deps.memory.findState(command.chatId),
      )) ?? createMemoryState(command.chatId);
    const watermark = previousState.processedThroughMessageId ?? -1;
    const delta = await trace.span("memory.delta.load", { memoryBatch }, () =>
      deps.messages.listAfterByChat(
        command.chatId,
        watermark,
        MEMORY_DELTA_BATCH_SIZE,
      ),
    );

    if (delta.length === 0) {
      trace.event("memory.complete", {
        memoryBatch,
        watermarkBefore: previousState.processedThroughMessageId,
      });
      return;
    }

    const fromMessageId = delta[0]!.id;
    const toMessageId = delta.at(-1)!.id;

    const nextState = await trace.span(
      "memory.process",
      {
        memoryBatch,
        messageCount: delta.length,
        fromMessageId,
        toMessageId,
        watermarkBefore: previousState.processedThroughMessageId,
      },
      () =>
        processChatDelta(previousState, delta, {
          model: {
            extractMemoryOps: (prompt) =>
              trace.span(
                "memory.model",
                { memoryBatch, promptChars: prompt.length },
                () =>
                  model.extractMemoryOps(prompt, {
                    operation: "memory-extraction",
                    chatId: command.chatId,
                    commandMessageId: command.commandMessageId,
                    memoryBatch,
                    messageCount: delta.length,
                    fromMessageId,
                    toMessageId,
                    watermarkBefore: previousState.processedThroughMessageId,
                  }),
              ),
          },
        }),
    );

    if (nextState === previousState) return;

    if (
      await trace.span("memory.persist", { memoryBatch }, () =>
        deps.memory.saveState(nextState, previousState.version),
      )
    ) {
      saveConflicts = 0;
      continue;
    }

    saveConflicts += 1;
    if (saveConflicts >= MAX_MEMORY_SAVE_CONFLICTS) {
      throw new Error(
        `Could not persist memory for chat ${command.chatId} after ${saveConflicts} version conflicts`,
      );
    }
  }
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const limit = Math.max(1, Math.floor(concurrency));
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex++;
        results[index] = await worker(items[index]!, index);
      }
    },
  );
  await Promise.all(runners);
  return results;
}

async function summarizeOnce<T>(
  key: string,
  run: () => Promise<T>,
): Promise<T> {
  const existing = pendingReconstructions.get(key) as Promise<T> | undefined;

  if (existing) {
    return existing;
  }

  const promise = run().finally(() => {
    pendingReconstructions.delete(key);
  });

  pendingReconstructions.set(key, promise);

  return promise;
}

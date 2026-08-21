import { randomUUID } from "node:crypto";
import type { MessagesRepo, SummariesRepo } from "@microsonya/db";
import type { SummarizationModelService } from "@microsonya/model-gateway";
import type { MemoryState, MemoryUpdate, SummaryCommand, SummaryRun } from "@microsonya/shared";
import { hashMessages } from "./infrastructure/hash-messages.js";
import { scheduleMemoryPersistence, waitForMemoryIdle } from "./memory/persistence.js";
import { buildSegmentPrompt } from "./prompts.js";
import { buildFinalRenderPrompt, buildSummaryEpisodes } from "./rendering/final-render.js";
import { segmentMessages } from "./pipeline/segment-messages.js";
import { selectSummaryWindow } from "./pipeline/window-selection.js";
import {
  SummaryWaterfall,
  type SummaryObserver,
  type SummaryWaterfallSink,
} from "./observability/waterfall.js";
import type { SummarizationTelemetryService } from "./observability/telemetry.js";

export type SummaryMessagesRepo = Pick<
  MessagesRepo,
  "listAfterByChat" | "listByChat"
>;

export type SummaryRunsRepo = Pick<
  SummariesRepo,
  "findCachedReconstruction" | "findLastRun" | "saveRun" | "saveReconstruction"
>;

export type SummaryModels = {
  reconstructSegment: SummarizationModelService["reconstructSegment"];
  renderSummary: SummarizationModelService["renderSummary"];
  extractMemoryOps?: SummarizationModelService["extractMemoryOps"];
};

export type MemoryModels = {
  extractMemoryOps: SummarizationModelService["extractMemoryOps"];
};

export type MemoryStateRepo = {
  findState(chatId: string): Promise<MemoryState | undefined>;
  saveState(update: MemoryUpdate, expectedVersion: number): Promise<boolean>;
};

export type SummarizeRuntimeDeps = {
  memory: MemoryStateRepo;
  messages: SummaryMessagesRepo;
  summaries: SummaryRunsRepo;
  models: SummaryModels;
  memoryModels?: MemoryModels;
  onTrace?: SummaryWaterfallSink;
  observer?: SummaryObserver;
  telemetry?: SummarizationTelemetryService;
  segmentConcurrency?: number;
  signal?: AbortSignal;
};

const pendingReconstructions = new Map<string, Promise<unknown>>();
const RECONSTRUCTION_SCHEMA_VERSION = 8;
const MIN_RECONSTRUCTION_OUTPUT_TOKENS = 2_048;
const MAX_RECONSTRUCTION_OUTPUT_TOKENS = 8_192;
const RECONSTRUCTION_OUTPUT_TOKENS_PER_MESSAGE = 320;

export const DEFAULT_SEGMENT_CONCURRENCY = 3;

const NO_NEW_MESSAGES = "No new messages to summarize.";

type Segment = ReturnType<typeof segmentMessages>[number];

export async function summarize(
  deps: SummarizeRuntimeDeps,
  command: SummaryCommand,
): Promise<string> {
  const trace = new SummaryWaterfall(
    command.chatId,
    command.commandMessageId,
    deps.onTrace ?? deps.telemetry?.record.bind(deps.telemetry),
    deps.observer,
  );

  try {
    return await summarizeCriticalPath(deps, command, trace);
  } finally {
    scheduleMemoryPersistence(deps, command, trace);
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
    return NO_NEW_MESSAGES;
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
    async (segment, index) => {
      deps.signal?.throwIfAborted();

      trace.event("segment.started", {
        segmentId: segment.id,
        segmentIndex: index + 1,
        segmentCount: segments.length,
      });

      const { reconstruction, cacheHit } = await loadSegmentReconstruction(
        deps,
        command,
        trace,
        segment,
      );

      completedSegments += 1;
      trace.event("segment.complete", {
        segmentId: segment.id,
        completedSegments,
        segmentCount: segments.length,
        ...(cacheHit ? { cacheStatus: "hit" } : {}),
      });

      return reconstruction;
    },
  );

  const episodes = await trace.span(
    "summary.select",
    { segmentCount: reconstructions.length },
    () => buildSummaryEpisodes(reconstructions),
  );
  const renderPrompt = await trace.span(
    "summary.prompt",
    { episodeCount: episodes.length },
    () => buildFinalRenderPrompt(episodes),
  );
  const rendered = await trace.span(
    "summary.model",
    { episodeCount: episodes.length, promptChars: renderPrompt.length },
    () =>
      deps.models.renderSummary(
        renderPrompt,
        {
          operation: "summary-render",
          chatId: command.chatId,
          commandMessageId: command.commandMessageId,
          messageCount: messages.length,
        },
        deps.signal,
      ),
  );
  const finalText = rendered.summary;

  const first = messages[0]!;
  const last = messages.at(-1)!;

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

async function loadSegmentReconstruction(
  deps: SummarizeRuntimeDeps,
  command: SummaryCommand,
  trace: SummaryWaterfall,
  segment: Segment,
) {
  const hash = hashMessages(segment.messages);
  const traceData = {
    segmentId: segment.id,
    messageCount: segment.messageCount,
  };

  const cached = await trace.span("segment.cache.lookup", traceData, () =>
    deps.summaries.findCachedReconstruction(
      segment.chatId,
      segment.fromMessageId,
      segment.toMessageId,
      hash,
      RECONSTRUCTION_SCHEMA_VERSION,
    ),
  );

  trace.event("segment.cache", {
    ...traceData,
    cacheStatus: cached ? "hit" : "miss",
  });

  if (cached) {
    return { reconstruction: cached, cacheHit: true } as const;
  }

  const prompt = await trace.span("segment.prompt", traceData, () =>
    buildSegmentPrompt(segment),
  );

  const reconstruction = await trace.span(
    "segment.model",
    { ...traceData, promptChars: prompt.length },
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

  return { reconstruction, cacheHit: false } as const;
}

export function reconstructionOutputTokenBudget(messageCount: number): number {
  const tokens =
    512 +
    Math.max(0, Math.floor(messageCount)) *
      RECONSTRUCTION_OUTPUT_TOKENS_PER_MESSAGE;

  return Math.min(
    MAX_RECONSTRUCTION_OUTPUT_TOKENS,
    Math.max(MIN_RECONSTRUCTION_OUTPUT_TOKENS, tokens),
  );
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const limit = Math.max(1, Math.floor(concurrency));
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const run = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await worker(items[index]!, index);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));

  return results;
}

async function summarizeOnce<T>(
  key: string,
  run: () => Promise<T>,
): Promise<T> {
  const existing = pendingReconstructions.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const promise = run().finally(() => {
    pendingReconstructions.delete(key);
  });

  pendingReconstructions.set(key, promise);
  return promise;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}


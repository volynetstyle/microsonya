import type { DiscussionSegment, SummaryCommand } from "@microsonya/shared";
import { hashMessages } from "../infrastructure/hash-messages.js";
import { buildSegmentPrompt } from "../prompts.js";
import { reconstructionOutputTokenBudget } from "../reconstruction/budget.js";
import type { SummaryWaterfall } from "../observability/waterfall.js";
import type { SummarizerDeps } from "./types.js";
import { mapConcurrent } from "./map-concurrent.js";

const SCHEMA_VERSION = 8;

export async function reconstructSegments(
  deps: SummarizerDeps,
  command: SummaryCommand,
  segments: readonly DiscussionSegment[],
  trace: SummaryWaterfall,
  signal?: AbortSignal,
) {
  let completed = 0;
  return mapConcurrent(
    segments,
    deps.segmentConcurrency ?? 3,
    async (segment, index) => {
      signal?.throwIfAborted();
      trace.event("segment.started", {
        segmentId: segment.id,
        segmentIndex: index + 1,
        segmentCount: segments.length,
      });
      const result = await reconstructSegment(
        deps,
        command,
        segment,
        trace,
        signal,
      );
      trace.event("segment.complete", {
        segmentId: segment.id,
        completedSegments: ++completed,
        segmentCount: segments.length,
        ...(result.cacheHit && { cacheStatus: "hit" as const }),
      });
      return result.reconstruction;
    },
  );
}

async function reconstructSegment(
  deps: SummarizerDeps,
  command: SummaryCommand,
  segment: DiscussionSegment,
  trace: SummaryWaterfall,
  signal?: AbortSignal,
) {
  const hash = hashMessages(segment.messages);
  const meta = { segmentId: segment.id, messageCount: segment.messageCount };
  const cached = await trace.span("segment.cache.lookup", meta, () =>
    deps.summaries.findCachedReconstruction(
      segment.chatId,
      segment.fromMessageId,
      segment.toMessageId,
      hash,
      SCHEMA_VERSION,
    ),
  );
  trace.event("segment.cache", {
    ...meta,
    cacheStatus: cached ? "hit" : "miss",
  });
  if (cached) return { reconstruction: cached, cacheHit: true } as const;

  const prompt = await trace.span("segment.prompt", meta, () =>
    buildSegmentPrompt(segment),
  );
  const reconstruction = await trace.span(
    "segment.model",
    { ...meta, promptChars: prompt.length },
    () =>
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
        signal,
      ),
  );
  await trace.span("segment.persist", { segmentId: segment.id }, () =>
    deps.summaries.saveReconstruction(reconstruction, SCHEMA_VERSION),
  );
  return { reconstruction, cacheHit: false } as const;
}

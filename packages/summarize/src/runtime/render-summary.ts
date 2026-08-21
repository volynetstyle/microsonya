import type { SegmentReconstruction } from "@microsonya/discourse";
import type { ChatMessage, SummaryCommand } from "@microsonya/shared";
import type { SummaryWaterfall } from "../observability/waterfall.js";
import {
  buildFinalRenderPrompt,
  buildSummaryEpisodes,
} from "../rendering/final-render.js";
import type { SummarizerDeps } from "./types.js";

export async function renderSummary(
  deps: SummarizerDeps,
  command: SummaryCommand,
  messages: readonly ChatMessage[],
  reconstructions: readonly SegmentReconstruction[],
  trace: SummaryWaterfall,
  signal?: AbortSignal,
): Promise<string> {
  const episodes = await trace.span(
    "summary.select",
    { segmentCount: reconstructions.length },
    () => buildSummaryEpisodes(reconstructions),
  );
  const prompt = await trace.span(
    "summary.prompt",
    { episodeCount: episodes.length },
    () => buildFinalRenderPrompt(episodes),
  );
  const result = await trace.span(
    "summary.model",
    { episodeCount: episodes.length, promptChars: prompt.length },
    () =>
      deps.models.renderSummary(
        prompt,
        {
          operation: "summary-render",
          chatId: command.chatId,
          commandMessageId: command.commandMessageId,
          messageCount: messages.length,
        },
        signal,
      ),
  );
  return result.summary;
}

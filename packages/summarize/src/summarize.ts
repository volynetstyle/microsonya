import type { SummaryCommand } from "@microsonya/shared";
import { SummaryWaterfall } from "./observability/waterfall.js";
import { segmentMessages } from "./pipeline/segment-messages.js";
import { selectSummaryWindow } from "./pipeline/window-selection.js";
import { persistSummaryRun } from "./runtime/persist-summary-run.js";
import { reconstructSegments } from "./runtime/reconstruct-segments.js";
import { renderSummary } from "./runtime/render-summary.js";
import type {
  Summarizer,
  SummarizerDeps,
  SummarizeOptions,
} from "./runtime/types.js";

const NO_NEW_MESSAGES = "No new messages to summarize.";

export function createSummarizer(deps: SummarizerDeps): Summarizer {
  return {
    summarize: (command, options) => runSummary(deps, command, options),
  };
}

async function runSummary(
  deps: SummarizerDeps,
  command: SummaryCommand,
  options: SummarizeOptions = {},
): Promise<string> {
  const trace = new SummaryWaterfall(
    command.chatId,
    command.commandMessageId,
    deps.telemetry?.record.bind(deps.telemetry),
    options.observer,
  );
  options.signal?.throwIfAborted();

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
  if (!messages.length) {
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
  const reconstructions = await reconstructSegments(
    deps,
    command,
    segments,
    trace,
    options.signal,
  );
  const finalText = await renderSummary(
    deps,
    command,
    messages,
    reconstructions,
    trace,
    options.signal,
  );
  await persistSummaryRun(deps.summaries, command, messages, finalText, trace);
  trace.event("summary.complete", {
    messageCount: messages.length,
    segmentCount: segments.length,
  });
  return finalText;
}

export type {
  Summarizer,
  SummarizerDeps,
  SummarizeOptions,
} from "./runtime/types.js";
export { reconstructionOutputTokenBudget } from "./reconstruction/budget.js";

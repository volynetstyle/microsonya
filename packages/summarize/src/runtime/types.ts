import type { MessagesRepo, SummariesRepo } from "@microsonya/db";
import type { SummarizationModelService } from "@microsonya/model-gateway";
import type { SummaryCommand } from "@microsonya/shared";
import type { SummarizationTelemetryService } from "../observability/telemetry.js";
import type { SummaryObserver } from "../observability/waterfall.js";

export type SummaryMessagesRepo = Pick<MessagesRepo, "listByChat">;
export type SummaryRunsRepo = Pick<
  SummariesRepo,
  "findCachedReconstruction" | "findLastRun" | "saveRun" | "saveReconstruction"
>;
export type SummaryModels = Pick<
  SummarizationModelService,
  "reconstructSegment" | "renderSummary"
>;

export type SummarizerDeps = {
  messages: SummaryMessagesRepo;
  summaries: SummaryRunsRepo;
  models: SummaryModels;
  telemetry?: SummarizationTelemetryService;
  segmentConcurrency?: number;
};

export type SummarizeOptions = {
  observer?: SummaryObserver;
  signal?: AbortSignal;
};

export type Summarizer = {
  summarize(
    command: SummaryCommand,
    options?: SummarizeOptions,
  ): Promise<string>;
};

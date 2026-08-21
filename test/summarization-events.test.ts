import { describe, expect, it, vi } from "vitest";
import {
  SummaryWaterfall,
  type SummarizationEvent,
} from "../packages/summarize/src/observability/waterfall.js";

describe("summarization events", () => {
  it("derives progress and telemetry from the same waterfall transitions", async () => {
    const observed: SummarizationEvent[] = [];
    const trace = new SummaryWaterfall("chat", 7, vi.fn(), {
      emit: (event) => {
        observed.push(event);
      },
    });

    trace.event("segment.started", {
      segmentId: "segment-1",
      segmentIndex: 1,
      segmentCount: 2,
    });
    trace.event("segment.complete", {
      segmentId: "segment-1",
      completedSegments: 1,
      segmentCount: 2,
    });
    await trace.span("summary.model", {}, async () => "done");
    trace.event("summary.complete");

    expect(observed).toEqual([
      {
        type: "segment-started",
        segmentId: "segment-1",
        index: 1,
        total: 2,
      },
      {
        type: "segment-completed",
        segmentId: "segment-1",
        completed: 1,
        total: 2,
      },
      { type: "render-started" },
      { type: "summary-completed" },
    ]);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LatencyAwareDisclosure,
  type DisclosureTransport,
} from "../apps/telegram/bot/src/summaryDisclosure.js";
import type { SummaryWaterfallEvent } from "../packages/summarize/src/index.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("latency-aware summary disclosure", () => {
  it("does not show transient activity for sub-second responses", async () => {
    vi.useFakeTimers();
    const transport = fakeTransport();
    const disclosure = createDisclosure(transport);

    disclosure.start();
    await disclosure.finish("final");
    await vi.runAllTimersAsync();

    expect(transport.sendTyping).not.toHaveBeenCalled();
    expect(transport.sendStatus).not.toHaveBeenCalled();
    expect(transport.sendFinal).toHaveBeenCalledWith("final");
  });

  it("uses typing between one and three seconds without a status message", async () => {
    vi.useFakeTimers();
    const transport = fakeTransport();
    const disclosure = createDisclosure(transport);

    disclosure.start();
    await vi.advanceTimersByTimeAsync(1_000);
    await disclosure.finish("final");

    expect(transport.sendTyping).toHaveBeenCalledTimes(1);
    expect(transport.sendStatus).not.toHaveBeenCalled();
    expect(transport.sendFinal).toHaveBeenCalledWith("final");
  });

  it("shows real workload at three seconds and edits it into the final result", async () => {
    vi.useFakeTimers();
    const transport = fakeTransport();
    const disclosure = createDisclosure(transport);
    disclosure.onTrace(
      traceEvent("segments.planned", {
        messageCount: 47,
        segmentCount: 6,
      }),
    );

    disclosure.start();
    await vi.advanceTimersByTimeAsync(3_000);
    await disclosure.finish("final");

    expect(transport.sendStatus).toHaveBeenCalledWith(
      "⏳ Аналізую чат\n47 повідомлень · 6 сегментів",
      false,
    );
    expect(transport.editStatus).toHaveBeenLastCalledWith(101, "final", false);
    expect(transport.sendFinal).not.toHaveBeenCalled();
  });

  it("reveals the real stage after ten seconds and cancellation after twenty", async () => {
    vi.useFakeTimers();
    const transport = fakeTransport();
    const disclosure = createDisclosure(transport);
    disclosure.onTrace(
      traceEvent("segments.planned", {
        messageCount: 47,
        segmentCount: 6,
      }),
    );
    disclosure.start();

    await vi.advanceTimersByTimeAsync(3_000);
    disclosure.onTrace(traceEvent("segment.model"));
    disclosure.onTrace(
      traceEvent("segment.complete", {
        completedSegments: 2,
        segmentCount: 6,
      }),
    );
    await vi.advanceTimersByTimeAsync(7_000);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(transport.editStatus).toHaveBeenCalledWith(
      101,
      "⏳ Формую підсумок\n47 повідомлень · 2/6 сегментів",
      false,
    );
    expect(transport.editStatus).toHaveBeenLastCalledWith(
      101,
      "⏳ Формую підсумок\n47 повідомлень · 2/6 сегментів",
      true,
    );

    await disclosure.fail("Скасовано.");
  });
});

function createDisclosure(transport: DisclosureTransport) {
  return new LatencyAwareDisclosure(transport, {
    typingMs: 1_000,
    statusMs: 3_000,
    detailMs: 10_000,
    cancelMs: 20_000,
  });
}

function fakeTransport(): DisclosureTransport & {
  sendTyping: ReturnType<typeof vi.fn>;
  sendStatus: ReturnType<typeof vi.fn>;
  editStatus: ReturnType<typeof vi.fn>;
  sendFinal: ReturnType<typeof vi.fn>;
} {
  return {
    sendTyping: vi.fn(async () => undefined),
    sendStatus: vi.fn(async () => 101),
    editStatus: vi.fn(async () => undefined),
    sendFinal: vi.fn(async () => undefined),
  };
}

function traceEvent(
  stage: string,
  values: Partial<SummaryWaterfallEvent> = {},
): SummaryWaterfallEvent {
  return {
    traceId: "chat:1",
    chatId: "chat",
    commandMessageId: 1,
    stage,
    status: "ok",
    offsetMs: 0,
    durationMs: 0,
    ...values,
  };
}

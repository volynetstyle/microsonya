import type { ChatId, MessageId } from "@microsonya/shared";
import type { SummaryExecutionEvent } from "./events.js";

export interface SummaryExecutionRecorder {
  record(event: SummaryExecutionEvent): void;
}

export interface SummaryExecutionContext {
  readonly traceId: string;
  readonly chatId: ChatId;
  readonly commandMessageId: MessageId;
}

/** Optional projection boundary. Implementations must not affect execution. */
export interface SummaryExecutionObserver {
  start(context: SummaryExecutionContext): SummaryExecutionRecorder;
}

export function startOptionalExecutionObserver(
  observer: SummaryExecutionObserver | undefined,
  context: SummaryExecutionContext,
): SummaryExecutionRecorder | undefined {
  if (observer === undefined) return undefined;
  try {
    const recorder = observer.start(context);
    return {
      record(event): void {
        try {
          recorder.record(event);
        } catch {
          // Operational projections are auxiliary. Evidence is recorded by a
          // separate required journal before this observer is invoked.
        }
      },
    };
  } catch {
    return undefined;
  }
}

export function combineSummaryExecutionRecorders(
  ...recorders: readonly (SummaryExecutionRecorder | undefined)[]
): SummaryExecutionRecorder {
  return {
    record(event): void {
      for (const recorder of recorders) recorder?.record(event);
    },
  };
}

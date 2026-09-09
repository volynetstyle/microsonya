import { ProgressiveSummarySession } from "./ProgressiveSummarySession.js";

export type ProgressiveState =
  | "idle"
  | "preparing"
  | "streaming"
  | "finalizing"
  | "completed"
  | "failed";

export type SummaryStreamEvent =
  | { readonly type: "delta"; readonly text: string }
  | { readonly type: "done" };

export interface SummaryStream {
  readonly chunks: AsyncIterable<string>;
}

export async function streamSummaryRun(
  stream: SummaryStream | AsyncIterable<string>,
  session: ProgressiveSummarySession,
  signal?: AbortSignal,
): Promise<string> {
  await session.begin();
  try {
    const chunks = Symbol.asyncIterator in stream ? stream : stream.chunks;
    for await (const delta of chunks) {
      signal?.throwIfAborted();
      session.append(delta);
    }
    signal?.throwIfAborted();
    return await session.complete();
  } catch (error) {
    await session.fail(error);
    throw error;
  }
}

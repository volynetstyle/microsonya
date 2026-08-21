import type { SummaryCommand } from "@microsonya/shared";
import { createMemoryState } from "./state.js";
import { processChatDelta } from "./runtime.js";
import type { MemoryModels, SummarizeRuntimeDeps } from "../summarize.js";
import type { SummaryWaterfall } from "../observability/waterfall.js";

const pendingUpdates = new Map<string, Promise<void>>();
const BATCH_SIZE = 100;
const MAX_SAVE_CONFLICTS = 3;

export function scheduleMemoryPersistence(
  deps: SummarizeRuntimeDeps,
  command: SummaryCommand,
  trace: SummaryWaterfall,
): void {
  const model = deps.memoryModels ?? deps.models;
  if (typeof model.extractMemoryOps !== "function") {
    trace.event("memory.skipped", { error: "No memory model configured" });
    return;
  }

  const previous = pendingUpdates.get(command.chatId) ?? Promise.resolve();
  const current = previous
    .catch(() => undefined)
    .then(nextEventLoopTurn)
    .then(() => persistMemoryDeltas(deps, model as MemoryModels, command, trace))
    .catch((error) => trace.event("memory.background", { error: errorMessage(error) }));

  pendingUpdates.set(command.chatId, current);
  void current.finally(() => {
    if (pendingUpdates.get(command.chatId) === current) pendingUpdates.delete(command.chatId);
  });
}

export async function waitForMemoryIdle(chatId: string): Promise<void> {
  await pendingUpdates.get(chatId);
}

async function persistMemoryDeltas(
  deps: SummarizeRuntimeDeps,
  model: MemoryModels,
  command: Pick<SummaryCommand, "chatId" | "commandMessageId">,
  trace: SummaryWaterfall,
): Promise<void> {
  let conflicts = 0;
  let batch = 0;
  while (true) {
    batch += 1;
    const previous = (await trace.span("memory.state.load", { memoryBatch: batch }, () => deps.memory.findState(command.chatId))) ?? createMemoryState(command.chatId);
    const watermark = previous.processedThroughMessageId ?? -1;
    const delta = await trace.span("memory.delta.load", { memoryBatch: batch }, () => deps.messages.listAfterByChat(command.chatId, watermark, BATCH_SIZE));
    if (delta.length === 0) {
      trace.event("memory.complete", { memoryBatch: batch, watermarkBefore: previous.processedThroughMessageId });
      return;
    }
    const meta = { memoryBatch: batch, messageCount: delta.length, fromMessageId: delta[0]!.id, toMessageId: delta.at(-1)!.id, watermarkBefore: previous.processedThroughMessageId };
    const update = await trace.span("memory.process", meta, () => processChatDelta(previous, delta, {
      model: { extractMemoryOps: (prompt) => trace.span("memory.model", { memoryBatch: batch, promptChars: prompt.length }, () => model.extractMemoryOps(prompt, { operation: "memory-extraction", chatId: command.chatId, commandMessageId: command.commandMessageId, ...meta })) },
    }));
    if (update.state === previous) return;
    const saved = await trace.span("memory.persist", { memoryBatch: batch }, () => deps.memory.saveState(update, previous.version));
    if (saved) { conflicts = 0; continue; }
    conflicts += 1;
    if (conflicts >= MAX_SAVE_CONFLICTS) throw new Error(`Could not persist memory for chat ${command.chatId} after ${conflicts} version conflicts`);
  }
}

function nextEventLoopTurn(): Promise<void> { return new Promise((resolve) => setImmediate(resolve)); }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

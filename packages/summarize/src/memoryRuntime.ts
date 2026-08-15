import type { ChatMessage, MemoryOp, MemoryState } from "@microsonya/shared";
import { hashMessages } from "./hashMessages.js";
import {
  DEFAULT_MAX_RELEVANT_MEMORY,
  normalizeMessages,
  retrieveRelevantMemory,
} from "./memoryInput.js";
import { reconcileMemoryOps, validateMemoryOps } from "./memoryOps.js";
import { buildMemoryOpsPrompt, MEMORY_PROMPT_VERSION } from "./memoryPrompt.js";
import { advanceMemoryWatermark, applyMemoryOps } from "./memoryState.js";

export type MemoryOpsModel = {
  extractMemoryOps(prompt: string): Promise<MemoryOp[]>;
};

export type ProcessChatDeltaOptions = {
  model: MemoryOpsModel;
  modelName?: string;
  promptVersion?: string;
  maxRelevantMemory?: number;
  now?: () => number;
};

export async function processChatDelta(
  previousState: MemoryState,
  newMessages: readonly ChatMessage[],
  options: ProcessChatDeltaOptions,
): Promise<MemoryState> {
  const normalized = normalizeMessages(previousState, newMessages);
  if (normalized.length === 0) return previousState;

  const semanticMessages = normalized.filter(
    (message) =>
      message.kind === "text" &&
      !message.isCommand &&
      message.text.trim().length > 0,
  );
  const toMessageId = normalized.at(-1)!.id;

  if (semanticMessages.length === 0) {
    return advanceMemoryWatermark(previousState, toMessageId);
  }

  const relevantMemory = retrieveRelevantMemory(
    previousState,
    semanticMessages,
    options.maxRelevantMemory ?? DEFAULT_MAX_RELEVANT_MEMORY,
  );
  const proposedOps = await options.model.extractMemoryOps(
    buildMemoryOpsPrompt(semanticMessages, relevantMemory),
  );
  const { valid } = validateMemoryOps(
    proposedOps,
    previousState,
    new Set(semanticMessages.map((message) => message.id)),
  );

  return applyMemoryOps(
    previousState,
    reconcileMemoryOps(valid, previousState),
    {
      chatId: previousState.chatId,
      fromMessageId: normalized[0]!.id,
      toMessageId,
      inputHash: hashMessages(normalized),
      model: options.modelName ?? "unknown",
      promptVersion: options.promptVersion ?? MEMORY_PROMPT_VERSION,
      createdAt: (options.now ?? Date.now)(),
    },
  );
}

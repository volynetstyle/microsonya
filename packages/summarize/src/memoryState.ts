import type {
  AppliedMemoryOp,
  MemoryItem,
  MemoryOp,
  MemoryState,
} from "@microsonya/shared";

export type ApplyMemoryMetadata = {
  chatId: string;
  fromMessageId: number;
  toMessageId: number;
  inputHash: string;
  model: string;
  promptVersion: string;
  createdAt: number;
};

export function createMemoryState(chatId: string): MemoryState {
  return {
    chatId,
    version: 0,
    processedThroughMessageId: null,
    nextMemorySequence: 1,
    nextOperationSequence: 1,
    items: [],
    operations: [],
  };
}

export function advanceMemoryWatermark(
  previousState: MemoryState,
  toMessageId: number,
): MemoryState {
  return {
    ...previousState,
    version: previousState.version + 1,
    processedThroughMessageId: toMessageId,
  };
}

export function applyMemoryOps(
  previousState: MemoryState,
  operations: readonly MemoryOp[],
  metadata: ApplyMemoryMetadata,
): MemoryState {
  const state = cloneState(previousState);
  const nextVersion = state.version + 1;
  state.version = nextVersion;
  state.processedThroughMessageId = metadata.toMessageId;

  for (const operation of operations) {
    const applied = applyOperation(state, operation);
    const record: AppliedMemoryOp = {
      id: formatId("mop", state.nextOperationSequence++),
      itemId: applied.itemId,
      createdItemId: applied.createdItemId,
      op: operation,
      chatId: metadata.chatId,
      fromMessageId: metadata.fromMessageId,
      toMessageId: metadata.toMessageId,
      inputHash: metadata.inputHash,
      model: metadata.model,
      promptVersion: metadata.promptVersion,
      stateVersion: nextVersion,
      createdAt: metadata.createdAt,
    };
    state.operations.push(record);
  }

  return state;
}

export function materializeMemoryState(
  chatId: string,
  operationLog: readonly AppliedMemoryOp[],
): MemoryState {
  const state = createMemoryState(chatId);
  for (const record of operationLog) {
    if (record.chatId !== chatId) {
      throw new Error(
        `Memory operation ${record.id} belongs to ${record.chatId}, not ${chatId}`,
      );
    }

    const applied = applyOperation(state, structuredClone(record.op));
    if (
      applied.itemId !== record.itemId ||
      applied.createdItemId !== record.createdItemId
    ) {
      throw new Error(
        `Memory operation ${record.id} has inconsistent runtime IDs`,
      );
    }

    state.operations.push({ ...record, op: structuredClone(record.op) });
    state.version = Math.max(state.version, record.stateVersion);
    state.processedThroughMessageId = Math.max(
      state.processedThroughMessageId ?? -1,
      record.toMessageId,
    );
    state.nextOperationSequence = Math.max(
      state.nextOperationSequence,
      parseSequence(record.id, "mop") + 1,
    );
  }
  return state;
}

function applyOperation(
  state: MemoryState,
  operation: MemoryOp,
): { itemId: string; createdItemId?: string } {
  const lastMessageId = Math.max(...operation.evidence);
  if (operation.type === "create") {
    const item = createItem(
      state,
      operation.kind,
      operation.text,
      operation.evidence,
    );
    return { itemId: item.id, createdItemId: item.id };
  }

  const target = state.items.find((item) => item.id === operation.targetId);
  if (!target) {
    throw new Error(
      `Validated memory target disappeared: ${operation.targetId}`,
    );
  }

  target.evidence = unionEvidence(target.evidence, operation.evidence);
  target.lastUpdatedMessageId = lastMessageId;
  switch (operation.type) {
    case "support":
      break;
    case "update":
      target.text = operation.text;
      break;
    case "resolve":
      target.status = "resolved";
      target.resolution = operation.text;
      break;
    case "retract":
      target.status = "retracted";
      break;
    case "supersede": {
      target.status = "superseded";
      const replacement = createItem(
        state,
        target.kind,
        operation.replacement,
        operation.evidence,
      );
      target.supersededBy = replacement.id;
      return { itemId: target.id, createdItemId: replacement.id };
    }
  }
  return { itemId: target.id };
}

function createItem(
  state: MemoryState,
  kind: MemoryItem["kind"],
  text: string,
  evidence: number[],
): MemoryItem {
  const item: MemoryItem = {
    id: formatId("mem", state.nextMemorySequence++),
    kind,
    text,
    status: "active",
    evidence: [...evidence],
    createdAtMessageId: Math.min(...evidence),
    lastUpdatedMessageId: Math.max(...evidence),
  };
  state.items.push(item);
  return item;
}

function cloneState(state: MemoryState): MemoryState {
  return {
    ...state,
    items: state.items.map((item) => ({
      ...item,
      evidence: [...item.evidence],
    })),
    operations: state.operations.map((operation) => ({
      ...operation,
      op: structuredClone(operation.op),
    })),
  };
}

function formatId(prefix: string, sequence: number): string {
  return `${prefix}_${String(sequence).padStart(6, "0")}`;
}

function parseSequence(id: string, prefix: string): number {
  const match = new RegExp(`^${prefix}_(\\d+)$`, "u").exec(id);
  if (!match) throw new Error(`Invalid ${prefix} ID: ${id}`);
  return Number(match[1]);
}

function unionEvidence(left: number[], right: number[]): number[] {
  return [...new Set([...left, ...right])].sort((a, b) => a - b);
}

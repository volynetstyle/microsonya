import type {
  AppliedMemoryOp,
  MemoryItem,
  MemoryOp,
  MemoryState,
  MemoryUpdate,
} from "@microsonya/shared";
import {
  addActiveIndexes,
  createMemoryTable,
  removeActiveIndexes,
  snapshotMemoryTable,
  type MemoryTable,
} from "./memoryTable.js";

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
  };
}

export function advanceMemoryWatermark(
  previousState: MemoryState,
  toMessageId: number,
): MemoryUpdate {
  return {
    state: {
      ...previousState,
      version: previousState.version + 1,
      processedThroughMessageId: toMessageId,
      items: previousState.items.map(cloneItem),
    },
    operations: [],
  };
}

export function applyMemoryOps(
  previousState: MemoryState,
  table: MemoryTable,
  operations: readonly MemoryOp[],
  metadata: ApplyMemoryMetadata,
): MemoryUpdate {
  const state: MemoryState = {
    ...previousState,
    version: previousState.version + 1,
    processedThroughMessageId: metadata.toMessageId,
  };
  const appliedOperations: AppliedMemoryOp[] = [];

  for (const operation of operations) {
    const applied = applyOperation(table, state, operation);
    appliedOperations.push({
      id: formatId("mop", state.nextOperationSequence++),
      itemId: applied.itemId,
      createdItemId: applied.createdItemId,
      op: structuredClone(operation),
      chatId: metadata.chatId,
      fromMessageId: metadata.fromMessageId,
      toMessageId: metadata.toMessageId,
      inputHash: metadata.inputHash,
      model: metadata.model,
      promptVersion: metadata.promptVersion,
      stateVersion: state.version,
      createdAt: metadata.createdAt,
    });
  }

  return {
    state: { ...state, items: snapshotMemoryTable(table) },
    operations: appliedOperations,
  };
}

export function materializeMemoryState(
  chatId: string,
  operationLog: readonly AppliedMemoryOp[],
): MemoryState {
  let state = createMemoryState(chatId);
  const table = createMemoryTable(state);

  for (const record of operationLog) {
    if (record.chatId !== chatId) {
      throw new Error(
        `Memory operation ${record.id} belongs to ${record.chatId}, not ${chatId}`,
      );
    }

    state = {
      ...state,
      version: Math.max(state.version, record.stateVersion),
      processedThroughMessageId: Math.max(
        state.processedThroughMessageId ?? -1,
        record.toMessageId,
      ),
    };
    const applied = applyOperation(table, state, structuredClone(record.op));
    if (
      applied.itemId !== record.itemId ||
      applied.createdItemId !== record.createdItemId
    ) {
      throw new Error(
        `Memory operation ${record.id} has inconsistent runtime IDs`,
      );
    }
    state.nextOperationSequence = Math.max(
      state.nextOperationSequence,
      parseSequence(record.id, "mop") + 1,
    );
  }

  return { ...state, items: snapshotMemoryTable(table) };
}

function applyOperation(
  table: MemoryTable,
  state: MemoryState,
  operation: MemoryOp,
): { itemId: string; createdItemId?: string } {
  const lastMessageId = Math.max(...operation.evidence);
  if (operation.type === "create") {
    const item = createItem(
      table,
      state,
      operation.kind,
      operation.text,
      operation.evidence,
    );
    return { itemId: item.id, createdItemId: item.id };
  }

  const target = table.byId.get(operation.targetId);
  if (!target)
    throw new Error(
      `Validated memory target disappeared: ${operation.targetId}`,
    );

  target.evidence = unionEvidence(target.evidence, operation.evidence);
  target.lastUpdatedMessageId = lastMessageId;
  switch (operation.type) {
    case "support":
      break;
    case "update":
      removeActiveIndexes(table, target);
      target.text = operation.text;
      addActiveIndexes(table, target);
      break;
    case "resolve":
      removeActiveIndexes(table, target);
      target.status = "resolved";
      target.resolution = operation.text;
      break;
    case "retract":
      removeActiveIndexes(table, target);
      target.status = "retracted";
      break;
    case "supersede": {
      removeActiveIndexes(table, target);
      target.status = "superseded";
      const replacement = createItem(
        table,
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
  table: MemoryTable,
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
  table.byId.set(item.id, item);
  addActiveIndexes(table, item);
  return item;
}

function cloneItem(item: MemoryItem): MemoryItem {
  return { ...item, evidence: [...item.evidence] };
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

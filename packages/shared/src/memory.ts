export type MemoryKind =
  | "fact"
  | "decision"
  | "open_question"
  | "plan"
  | "result";

export type MemoryStatus = "active" | "resolved" | "superseded" | "retracted";

export type MemoryOp =
  | {
      type: "create";
      kind: MemoryKind;
      text: string;
      evidence: number[];
    }
  | {
      type: "support";
      targetId: string;
      evidence: number[];
    }
  | {
      type: "update";
      targetId: string;
      text: string;
      evidence: number[];
    }
  | {
      type: "resolve";
      targetId: string;
      text: string;
      evidence: number[];
    }
  | {
      type: "supersede";
      targetId: string;
      replacement: string;
      evidence: number[];
    }
  | {
      type: "retract";
      targetId: string;
      evidence: number[];
    };

export interface MemoryItem {
  id: string;
  kind: MemoryKind;
  text: string;
  status: MemoryStatus;
  evidence: number[];
  createdAtMessageId: number;
  lastUpdatedMessageId: number;
  supersededBy?: string;
  resolution?: string;
}

export interface AppliedMemoryOp {
  id: string;
  itemId: string;
  createdItemId?: string;
  op: MemoryOp;
  chatId: string;
  fromMessageId: number;
  toMessageId: number;
  inputHash: string;
  model: string;
  promptVersion: string;
  stateVersion: number;
  createdAt: number;
}

export interface MemoryState {
  chatId: string;
  version: number;
  processedThroughMessageId: number | null;
  nextMemorySequence: number;
  nextOperationSequence: number;
  items: MemoryItem[];
  operations: AppliedMemoryOp[];
}

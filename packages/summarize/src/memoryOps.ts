import type { MemoryItem, MemoryOp, MemoryState } from "@microsonya/shared";
import { normalizeMemoryText } from "./memoryInput.js";

const MAX_MEMORY_TEXT_LENGTH = 2_000;

export type RejectedMemoryOp = { op: MemoryOp; reason: string };
export type ValidatedMemoryOps = {
  valid: MemoryOp[];
  rejected: RejectedMemoryOp[];
};

export function validateMemoryOps(
  operations: readonly MemoryOp[],
  state: MemoryState,
  allowedEvidence: ReadonlySet<number>,
): ValidatedMemoryOps {
  const valid: MemoryOp[] = [];
  const rejected: RejectedMemoryOp[] = [];
  const items = new Map(state.items.map((item) => [item.id, item]));

  for (const rawOperation of operations) {
    const operation = normalizeOperation(rawOperation);
    const reason = validateOperation(operation, items, allowedEvidence);
    if (reason) rejected.push({ op: rawOperation, reason });
    else valid.push(operation);
  }
  return { valid, rejected };
}

export function reconcileMemoryOps(
  operations: readonly MemoryOp[],
  state: MemoryState,
): MemoryOp[] {
  const activeByIdentity = new Map(
    state.items
      .filter((item) => item.status === "active")
      .map((item) => [memoryIdentity(item.kind, item.text), item]),
  );
  const seenTerminalTargets = new Set<string>();
  const pendingCreates = new Map<string, number>();
  const reconciled: MemoryOp[] = [];

  for (const operation of operations) {
    if (operation.type === "create") {
      const identity = memoryIdentity(operation.kind, operation.text);
      const existing = activeByIdentity.get(identity);
      if (existing) {
        reconciled.push({
          type: "support",
          targetId: existing.id,
          evidence: operation.evidence,
        });
      } else {
        const pendingIndex = pendingCreates.get(identity);
        const pending =
          pendingIndex === undefined ? undefined : reconciled[pendingIndex];
        if (pending?.type === "create") {
          pending.evidence = unionEvidence(
            pending.evidence,
            operation.evidence,
          );
        } else {
          pendingCreates.set(identity, reconciled.length);
          reconciled.push(structuredClone(operation));
        }
      }
      continue;
    }

    if (seenTerminalTargets.has(operation.targetId)) continue;
    if (isTerminalOperation(operation)) {
      seenTerminalTargets.add(operation.targetId);
    }
    reconciled.push(operation);
  }

  return mergeAdjacentSupports(reconciled);
}

function validateOperation(
  operation: MemoryOp,
  items: ReadonlyMap<string, MemoryItem>,
  allowedEvidence: ReadonlySet<number>,
): string | null {
  if (operation.evidence.length === 0) return "evidence must not be empty";
  if (operation.evidence.some((id) => !allowedEvidence.has(id))) {
    return "evidence references a message outside the normalized delta";
  }
  const text = operationText(operation);
  if (text !== undefined && text.length === 0) return "text must not be empty";
  if (text !== undefined && text.length > MAX_MEMORY_TEXT_LENGTH) {
    return `text exceeds ${MAX_MEMORY_TEXT_LENGTH} characters`;
  }
  if (operation.type === "create") return null;

  const target = items.get(operation.targetId);
  if (!target) return "targetId does not exist";
  if (target.status !== "active") return "targetId is not active";
  if (operation.type === "resolve" && target.kind !== "open_question") {
    return "resolve may only target an open_question";
  }
  return null;
}

function normalizeOperation(operation: MemoryOp): MemoryOp {
  const evidence = [...new Set(operation.evidence)]
    .filter(Number.isSafeInteger)
    .sort((left, right) => left - right);
  switch (operation.type) {
    case "create":
      return {
        ...operation,
        text: normalizeMemoryText(operation.text),
        evidence,
      };
    case "update":
    case "resolve":
      return {
        ...operation,
        text: normalizeMemoryText(operation.text),
        evidence,
      };
    case "supersede":
      return {
        ...operation,
        replacement: normalizeMemoryText(operation.replacement),
        evidence,
      };
    case "support":
    case "retract":
      return { ...operation, evidence };
  }
}

function operationText(operation: MemoryOp): string | undefined {
  if (operation.type === "create") return operation.text;
  if (operation.type === "update" || operation.type === "resolve") {
    return operation.text;
  }
  if (operation.type === "supersede") return operation.replacement;
  return undefined;
}

function isTerminalOperation(
  operation: MemoryOp,
): operation is Extract<
  MemoryOp,
  { type: "resolve" | "supersede" | "retract" }
> {
  return (
    operation.type === "resolve" ||
    operation.type === "supersede" ||
    operation.type === "retract"
  );
}

function mergeAdjacentSupports(operations: readonly MemoryOp[]): MemoryOp[] {
  const merged: MemoryOp[] = [];
  for (const operation of operations) {
    const previous = merged.at(-1);
    if (
      operation.type === "support" &&
      previous?.type === "support" &&
      previous.targetId === operation.targetId
    ) {
      previous.evidence = unionEvidence(previous.evidence, operation.evidence);
      continue;
    }
    merged.push(structuredClone(operation));
  }
  return merged;
}

function memoryIdentity(kind: MemoryItem["kind"], text: string): string {
  return `${kind}:${normalizeMemoryText(text).toLocaleLowerCase("en-US")}`;
}

function unionEvidence(left: number[], right: number[]): number[] {
  return [...new Set([...left, ...right])].sort((a, b) => a - b);
}

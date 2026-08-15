import type { MemoryItem, MemoryKind, MemoryState } from "@microsonya/shared";
import { normalizeMemoryText } from "./memoryInput.js";

export type MemoryTable = {
  byId: Map<string, MemoryItem>;
  activeByIdentity: Map<string, string>;
  activeByKind: Map<MemoryKind, Set<string>>;
  tokenIndex: Map<string, Set<string>>;
};

export function createMemoryTable(state: MemoryState): MemoryTable {
  const table: MemoryTable = {
    byId: new Map(),
    activeByIdentity: new Map(),
    activeByKind: new Map(),
    tokenIndex: new Map(),
  };

  for (const item of state.items) {
    table.byId.set(item.id, cloneItem(item));
    if (item.status === "active") addActiveIndexes(table, item);
  }

  return table;
}

export function snapshotMemoryTable(table: MemoryTable): MemoryItem[] {
  return [...table.byId.values()].map(cloneItem);
}

export function findActiveMemory(
  table: MemoryTable,
  kind: MemoryKind,
  text: string,
): MemoryItem | undefined {
  const id = table.activeByIdentity.get(memoryIdentity(kind, text));
  return id === undefined ? undefined : table.byId.get(id);
}

export function addActiveIndexes(table: MemoryTable, item: MemoryItem): void {
  table.activeByIdentity.set(memoryIdentity(item.kind, item.text), item.id);
  const kindIds = table.activeByKind.get(item.kind) ?? new Set<string>();
  kindIds.add(item.id);
  table.activeByKind.set(item.kind, kindIds);
  for (const token of tokenizeMemoryText(item.text)) {
    const ids = table.tokenIndex.get(token) ?? new Set<string>();
    ids.add(item.id);
    table.tokenIndex.set(token, ids);
  }
}

export function removeActiveIndexes(
  table: MemoryTable,
  item: MemoryItem,
): void {
  table.activeByIdentity.delete(memoryIdentity(item.kind, item.text));
  const kindIds = table.activeByKind.get(item.kind);
  kindIds?.delete(item.id);
  if (kindIds?.size === 0) table.activeByKind.delete(item.kind);
  for (const token of tokenizeMemoryText(item.text)) {
    const ids = table.tokenIndex.get(token);
    if (!ids) continue;
    ids.delete(item.id);
    if (ids.size === 0) table.tokenIndex.delete(token);
  }
}

export function memoryIdentity(kind: MemoryKind, text: string): string {
  return `${kind}:${normalizeMemoryText(text).toLocaleLowerCase("en-US")}`;
}

export function tokenizeMemoryText(text: string): string[] {
  return [
    ...new Set(
      normalizeMemoryText(text)
        .toLocaleLowerCase("en-US")
        .match(/[\p{L}\p{N}_-]{3,}/gu) ?? [],
    ),
  ];
}

function cloneItem(item: MemoryItem): MemoryItem {
  return { ...item, evidence: [...item.evidence] };
}

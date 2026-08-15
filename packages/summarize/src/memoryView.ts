import type { MemoryItem, MemoryKind, MemoryState } from "@microsonya/shared";

const KIND_WEIGHT: Record<MemoryKind, number> = {
  decision: 50,
  open_question: 45,
  plan: 40,
  result: 35,
  fact: 30,
};

export type MemorySummaryOptions = {
  maxItems?: number;
};

export function selectMemoryForSummary(
  state: MemoryState,
  options: MemorySummaryOptions = {},
): MemoryItem[] {
  const maxItems = Math.max(0, options.maxItems ?? 15);
  const newestMessageId = Math.max(
    1,
    ...state.items.map((item) => item.lastUpdatedMessageId),
  );

  return state.items
    .filter((item) => item.status === "active" || item.status === "resolved")
    .map((item) => ({
      item,
      score:
        KIND_WEIGHT[item.kind] +
        (item.status === "active" ? 10 : 0) +
        (item.kind === "open_question" && item.status === "active" ? 10 : 0) +
        Math.log2(item.evidence.length + 1) * 5 +
        (item.lastUpdatedMessageId / newestMessageId) * 10,
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.item.lastUpdatedMessageId - left.item.lastUpdatedMessageId ||
        left.item.id.localeCompare(right.item.id),
    )
    .slice(0, maxItems)
    .map(({ item }) => item);
}

export function renderMemorySummary(
  state: MemoryState,
  options: MemorySummaryOptions = {},
): string {
  const selected = selectMemoryForSummary(state, options);
  if (selected.length === 0) return "No persistent memory yet.";

  const sections: Array<[string, MemoryItem[]]> = [
    ["Decisions", selected.filter((item) => item.kind === "decision")],
    ["Plans", selected.filter((item) => item.kind === "plan")],
    ["Results", selected.filter((item) => item.kind === "result")],
    ["Facts", selected.filter((item) => item.kind === "fact")],
    [
      "Open questions",
      selected.filter(
        (item) => item.kind === "open_question" && item.status === "active",
      ),
    ],
    [
      "Resolved questions",
      selected.filter(
        (item) => item.kind === "open_question" && item.status === "resolved",
      ),
    ],
  ];

  return sections
    .filter(([, items]) => items.length > 0)
    .map(
      ([title, items]) =>
        `${title}\n${items.map((item) => `- ${renderItem(item)}`).join("\n")}`,
    )
    .join("\n\n");
}

function renderItem(item: MemoryItem): string {
  if (item.status === "resolved" && item.resolution) {
    return `${item.text} → ${item.resolution}`;
  }
  return item.text;
}

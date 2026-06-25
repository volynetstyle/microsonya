import { SegmentSummary } from "@microsonya/shared";
import { RawSegmentSummary } from "./prompts.js";

export function parseSegmentSummaryJson(
  raw: string,
  meta: {
    segmentId: string;
    chatId: string;
    fromMessageId: number;
    toMessageId: number;
    hash: string;
  }
): SegmentSummary {
  const parsed = parseJsonObject(raw);
  const data = normalizeRawSegmentSummary(parsed);

  return {
    segmentId: meta.segmentId,
    chatId: meta.chatId,
    fromMessageId: meta.fromMessageId,
    toMessageId: meta.toMessageId,
    hash: meta.hash,

    title: data.title,
    summary: data.summary,
    decisions: data.decisions,
    openQuestions: data.openQuestions,
    jokes: data.jokes,
    mentionedPeople: data.mentionedPeople,
    importance: data.importance
  };
}

function parseJsonObject(raw: string): unknown {
  const text = extractJson(raw);

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Invalid segment summary JSON: ${text.slice(0, 500)}`);
  }
}

function extractJson(raw: string): string {
  const trimmed = raw.trim();

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");

  if (first !== -1 && last !== -1 && last > first) {
    return trimmed.slice(first, last + 1);
  }

  return trimmed;
}

function normalizeRawSegmentSummary(value: unknown): RawSegmentSummary {
  if (!isRecord(value)) {
    throw new Error("Segment summary must be a JSON object");
  }

  return {
    title: readString(value.title, "Без теми").slice(0, 120),
    summary: readStringArray(value.summary),
    decisions: readStringArray(value.decisions),
    openQuestions: readStringArray(value.openQuestions),
    jokes: readStringArray(value.jokes),
    mentionedPeople: unique(readStringArray(value.mentionedPeople)),
    importance: readImportance(value.importance)
  };
}

function readString(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readImportance(value: unknown): 0 | 1 | 2 | 3 {
  if (value === 0 || value === 1 || value === 2 || value === 3) {
    return value;
  }

  return 1;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
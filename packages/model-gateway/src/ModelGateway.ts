import { z } from "zod";
import type { DiscussionSegment, FinalSummary, SegmentSummary } from "@microsonya/shared";
import type { ModelClient } from "./ModelClient.js";

const stringArraySchema = z.preprocess(
  (value) => {
    if (Array.isArray(value)) {
      return value;
    }

    if (typeof value === "string" && value.trim() !== "") {
      return [value];
    }

    return [];
  },
  z.array(z.string()),
);

const segmentSummarySchema = z.object({
  title: z.string().default(""),
  summary: stringArraySchema.default([]),
  decisions: stringArraySchema.default([]),
  openQuestions: stringArraySchema.default([]),
  jokes: stringArraySchema.default([]),
  mentionedPeople: stringArraySchema.default([]),
  importance: z.coerce
    .number()
    .int()
    .min(0)
    .max(3)
    .catch(0)
    .transform((value) => value as 0 | 1 | 2 | 3)
});

export class ModelGateway {
  constructor(private readonly client: ModelClient) {}

  async summarizeSegment(segment: DiscussionSegment, hash: string, prompt: string): Promise<SegmentSummary> {
    const raw = await this.client.complete(prompt, "json");
    const parsed = await this.parseOrRepairSegmentSummary(raw, segment);

    return {
      segmentId: segment.id,
      chatId: segment.chatId,
      fromMessageId: segment.fromMessageId,
      toMessageId: segment.toMessageId,
      hash,
      ...parsed
    };
  }

  async mergeSummaries(_summaries: SegmentSummary[], prompt: string): Promise<FinalSummary> {
    return { text: await this.client.complete(prompt, "text") };
  }

  getModelStats(): unknown[] {
    return this.client.getFreeModelSwitchSnapshot?.() ?? [];
  }

  private async parseOrRepairSegmentSummary(
    raw: string,
    segment: DiscussionSegment,
  ): Promise<z.infer<typeof segmentSummarySchema>> {
    try {
      return segmentSummarySchema.parse(extractJsonObject(raw));
    } catch (error) {
      console.warn(
        "Model returned non-JSON segment summary; using local fallback",
        safeStringify({
          segmentId: segment.id,
          error: error instanceof Error ? error.message : String(error),
          raw: raw.slice(0, 500),
        }),
      );

      return buildFallbackSegmentSummary(segment);
    }
  }
}

function buildFallbackSegmentSummary(
  segment: DiscussionSegment,
): z.infer<typeof segmentSummarySchema> {
  const facts = segment.messages
    .filter((message) => message.text.trim() !== "")
    .slice(0, 5)
    .map((message) => {
      const author = message.authorName.trim() || message.authorId;
      return `${author}: ${message.text.trim()}`;
    });

  return {
    title: "Короткий фрагмент чату",
    summary: facts.length > 0 ? facts : ["Не вдалося структурувати зміст сегмента."],
    decisions: [],
    openQuestions: [],
    jokes: [],
    mentionedPeople: [...new Set(segment.participants)].slice(0, 10),
    importance: facts.length > 0 ? 1 : 0,
  };
}

function extractJsonObject(raw: string): unknown {
  const cleaned = raw
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");

    if (start === -1 || end === -1 || end <= start) {
      throw new Error(`Model did not return JSON: ${raw.slice(0, 500)}`);
    }

    return JSON.parse(cleaned.slice(start, end + 1));
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

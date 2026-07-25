import { z } from "zod";
import type {
  DiscussionSegment,
  FinalSummary,
  SegmentSummary,
} from "@microsonya/shared";
import { InvalidModelOutputError, type ModelClient } from "./ModelClient.js";

const stringArraySchema = z.preprocess((value) => {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    return [value];
  }

  return [];
}, z.array(z.string()));

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
    .transform((value) => value as 0 | 1 | 2 | 3),
});

export class ModelGateway {
  constructor(private readonly client: ModelClient) {}

  async summarizeSegment(
    segment: DiscussionSegment,
    hash: string,
    prompt: string,
  ): Promise<SegmentSummary> {
    const parsed = await this.generateSegmentSummary(prompt, segment);

    return {
      segmentId: segment.id,
      chatId: segment.chatId,
      fromMessageId: segment.fromMessageId,
      toMessageId: segment.toMessageId,
      hash,
      ...parsed,
    };
  }

  async mergeSummaries(
    _summaries: SegmentSummary[],
    prompt: string,
  ): Promise<FinalSummary> {
    return { text: await this.client.generateText(prompt) };
  }

  private async generateSegmentSummary(
    prompt: string,
    segment: DiscussionSegment,
  ): Promise<z.infer<typeof segmentSummarySchema>> {
    try {
      return segmentSummarySchema.parse(
        await this.client.generateObject(prompt, segmentSummarySchema),
      );
    } catch (error) {
      if (!(error instanceof InvalidModelOutputError)) {
        throw error;
      }

      console.warn(
        "Model returned an invalid segment summary; using local fallback",
        safeStringify({
          segmentId: segment.id,
          error: error.message,
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
    summary:
      facts.length > 0 ? facts : ["Не вдалося структурувати зміст сегмента."],
    decisions: [],
    openQuestions: [],
    jokes: [],
    mentionedPeople: [...new Set(segment.participants)].slice(0, 10),
    importance: facts.length > 0 ? 1 : 0,
  };
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

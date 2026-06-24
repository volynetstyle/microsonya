import { z } from "zod";
import type { DiscussionSegment, FinalSummary, SegmentSummary } from "@microsonya/shared";
import type { ModelClient } from "./ModelClient.js";

const segmentSummarySchema = z.object({
  title: z.string(),
  summary: z.array(z.string()),
  decisions: z.array(z.string()),
  openQuestions: z.array(z.string()),
  jokes: z.array(z.string()),
  mentionedPeople: z.array(z.string()),
  importance: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)])
});

export class ModelGateway {
  constructor(private readonly client: ModelClient) {}

  async summarizeSegment(segment: DiscussionSegment, hash: string, prompt: string): Promise<SegmentSummary> {
    const raw = await this.client.complete(prompt, "json");
    const parsed = segmentSummarySchema.parse(JSON.parse(raw));

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
}

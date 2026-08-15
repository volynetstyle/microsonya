import {
  buildDiscoursePrompt,
  PIPE_V3_LANGUAGE_GUIDE,
  serializePipeV3,
  type DiscourseMessage,
} from "@microsonya/discourse";
import type { DiscussionSegment } from "@microsonya/shared";

export function buildSegmentPrompt(segment: DiscussionSegment): string {
  const messages: DiscourseMessage[] = segment.messages.map((message) => ({
    id: message.id,
    user: message.authorName.trim() || message.authorId,
    time: new Date(message.date).toISOString(),
    replyTo: message.replyToId,
    text: message.text || undefined,
    media: message.kind,
  }));

  return [
    buildDiscoursePrompt(
      serializePipeV3(messages),
      "pipe-v3",
      PIPE_V3_LANGUAGE_GUIDE,
    ),
    "Output language requirement: write title, topicTitle, statement, and action values in Ukrainian. Preserve speaker identifiers. Keep JSON property names, event ids, and topicId values English-compatible.",
  ].join("\n\n");
}

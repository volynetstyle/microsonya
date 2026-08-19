import {
  buildClaimsPrompt,
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
    buildClaimsPrompt(
      serializePipeV3(messages),
      "pipe-v3",
      PIPE_V3_LANGUAGE_GUIDE,
    ),
    "Вимога до мови відповіді: пиши title, topic і text українською. Зберігай авторство тверджень у text. Назви JSON-полів залишай без змін.",
  ].join("\n\n");
}

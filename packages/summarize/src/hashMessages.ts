import { createHash } from "node:crypto";
import type { ChatMessage } from "@microsonya/shared";

export function hashMessages(messages: ChatMessage[]): string {
  const payload = messages.map((message) => ({
    id: message.id,
    date: message.date,
    authorId: message.authorId,
    text: message.text,
    replyToId: message.replyToId ?? null,
    kind: message.kind
  }));

  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

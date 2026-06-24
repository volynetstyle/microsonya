import type { MessagesRepo } from "@microsonya/db";
import type { ChatMessage } from "@microsonya/shared";

export function ingestMessage(messages: MessagesRepo, message: ChatMessage): void {
  if (message.kind !== "text" || message.text.trim() === "") {
    return;
  }

  messages.save(message);
}

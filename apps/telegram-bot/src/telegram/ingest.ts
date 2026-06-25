import type { MessagesRepo } from "@microsonya/db";
import type { ChatMessage } from "@microsonya/shared";

export function ingestMessage(
  messages: MessagesRepo,
  message: ChatMessage,
): void {
  if (!isSummarizableMessage(message)) {
    return;
  }

  messages.save(message);
}

export function isSummarizableMessage(message: ChatMessage): boolean {
  return message.kind === "text" && message.text.trim() !== "";
}
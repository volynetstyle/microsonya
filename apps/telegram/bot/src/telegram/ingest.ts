import type { MessagesRepo } from "@microsonya/db";
import type { ChatMessage } from "@microsonya/shared";

export function ingestMessage(
  messages: MessagesRepo,
  message: ChatMessage,
): Promise<void> {
  if (!isSummarizableMessage(message)) {
    return Promise.resolve();
  }

  return messages.save(message);
}

export function isSummarizableMessage(message: ChatMessage): boolean {
  return message.kind === "text" && message.text.trim() !== "";
}

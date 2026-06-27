import type { ChatMessage } from "@microsonya/shared";

export type MessageSink = {
  save(message: ChatMessage): Promise<void>;
};

export function ingestMessage(
  messages: MessageSink,
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

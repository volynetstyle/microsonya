import type { ChatMessage } from "@microsonya/shared";

export function coverageOf(messages: readonly ChatMessage[]) {
  return {
    firstId: messages[0]!.id,
    lastId: messages.at(-1)!.id,
    count: messages.length,
  };
}

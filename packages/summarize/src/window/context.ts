import type { ChatMessage, MessageId } from "@microsonya/shared";
import { compareChronologically } from "./chronology.js";

/**
 * Finds reply-parent context after the final eligible set is known.
 *
 * Keeping this as a second linear scan avoids constructing a full
 * MessageId -> message index for histories where only a handful of
 * reply parents are needed.
 */
export function selectContextMessages(
  all: readonly ChatMessage[],
  neededParentIds: ReadonlySet<MessageId>,
): ChatMessage[] {
  if (neededParentIds.size === 0) {
    return [];
  }

  const context: ChatMessage[] = [];

  for (let i = 0; i < all.length; i++) {
    const message = all[i]!;

    if (neededParentIds.has(message.id)) {
      context.push(message);
    }
  }

  context.sort(compareChronologically);

  return context;
}

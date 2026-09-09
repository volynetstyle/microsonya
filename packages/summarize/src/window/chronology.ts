import type { ChatMessage } from "@microsonya/shared";

/**
 * Stable merge of two chronological sequences.
 *
 * On equality, left/context is selected first because the old code
 * constructed:
 *
 *   [...contextMessages, ...eligibleMessages]
 *
 * before its stable sort.
 */
export function mergeChronologically(
  context: readonly ChatMessage[],
  eligible: readonly ChatMessage[],
): ChatMessage[] {
  if (context.length === 0) {
    return eligible.slice();
  }

  if (eligible.length === 0) {
    return context.slice();
  }

  const merged = new Array<ChatMessage>(context.length + eligible.length);

  let contextIndex = 0;
  let eligibleIndex = 0;
  let outputIndex = 0;

  while (contextIndex < context.length && eligibleIndex < eligible.length) {
    const contextMessage = context[contextIndex]!;
    const eligibleMessage = eligible[eligibleIndex]!;

    if (compareChronologically(contextMessage, eligibleMessage) <= 0) {
      merged[outputIndex++] = contextMessage;
      contextIndex++;
    } else {
      merged[outputIndex++] = eligibleMessage;
      eligibleIndex++;
    }
  }

  while (contextIndex < context.length) {
    merged[outputIndex++] = context[contextIndex++]!;
  }

  while (eligibleIndex < eligible.length) {
    merged[outputIndex++] = eligible[eligibleIndex++]!;
  }

  return merged;
}

export function compareChronologically(
  left: ChatMessage,
  right: ChatMessage,
): number {
  return left.time - right.time || left.id - right.id;
}

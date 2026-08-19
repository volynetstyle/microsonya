import type { EvalMessage } from "../types.js";

export function serializeNatural(messages: EvalMessage[]): string {
  return messages
    .map((message) => {
      const reply =
        message.replyTo == null ? "" : `, replying to #${message.replyTo}`;
      const content = message.text ?? `[sent ${message.media}]`;
      return `#${message.id} [${message.time}] ${message.user}${reply}: ${content}`;
    })
    .join("\n");
}

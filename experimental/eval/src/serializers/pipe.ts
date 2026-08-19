import type { EvalMessage } from "../types.js";

function escape(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("|", "\\|")
    .replaceAll("\n", "\\n");
}

export function serializePipe(messages: EvalMessage[]): string {
  return [
    "id|time|user|replyTo|content",
    ...messages.map((message) => {
      const content = message.text ?? `[media:${message.media}]`;
      return [
        message.id,
        escape(message.time),
        escape(message.user),
        message.replyTo ?? "",
        escape(content),
      ].join("|");
    }),
  ].join("\n");
}

import type { DiscourseMessage } from "./production.js";

export const PIPE_V3_LANGUAGE_GUIDE = [
  "Граматика рядка: #ID|AUTHOR_JSON|TIME_JSON|^PARENT|KIND_JSON|TEXT_JSON_OR_NULL",
  "^0 означає відсутність явного reply; ^N означає пряму відповідь на повідомлення #N.",
  "Рядки розташовані хронологічно.",
  "Reply-зв'язки допомагають визначати, до якої гілки розмови належить повідомлення.",
  "Посилайся на ID повідомлень у полі evidence.",
].join("\n");

export function serializePipeV3(messages: DiscourseMessage[]): string {
  return [
    "PIPECHAT/3",
    ...messages.map((message) =>
      [
        `#${message.id}`,
        JSON.stringify(message.user),
        JSON.stringify(message.time),
        `^${message.replyTo ?? 0}`,
        JSON.stringify(message.media ?? "text"),
        message.text === undefined ? "null" : JSON.stringify(message.text),
      ].join("|"),
    ),
  ].join("\n");
}

import type { DiscourseMessage } from "./types.js";

export const PIPE_V3_LANGUAGE_GUIDE = [
  "Grammar: #ID|AUTHOR_JSON|TIME_JSON|^PARENT|KIND_JSON|TEXT_JSON_OR_NULL",
  "^0 means no explicit parent; ^N is a direct reply to message #N. Cite message IDs in evidence.",
  "Rows are chronological. Reply edges define conversation branches; row adjacency does not.",
  "Encoding describes structure, not importance.",
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

import type { EvalMessage } from "../types.js";

export const PIPE_V2_LANGUAGE_GUIDE = [
  "PIPECHAT/2 is a lossless line-oriented chat language.",
  "Grammar:",
  'message := "#" ID "|at=" JSON_STRING "|by=" JSON_STRING "|reply=" ("-" | "#" ID) "|kind=" TOKEN "|text=" (JSON_STRING | "-")',
  "Semantics:",
  "- #ID is the stable message ID. Cite this number in evidence arrays.",
  "- reply=#ID is a directed reply edge to that earlier message; reply=- means no explicit parent.",
  "- kind identifies text or media. text=- means the message has no textual content.",
  "- JSON_STRING uses JSON escaping, so escaped newlines and punctuation remain part of one message.",
  "- Input order is chronological, but adjacent messages may belong to different interleaved threads.",
  "First reconstruct threads from reply edges; use chronology and topic similarity only as secondary signals.",
].join("\n");

export function serializePipeV2(messages: EvalMessage[]): string {
  return [
    "PIPECHAT/2",
    ...messages.map((message) => {
      const reply = message.replyTo == null ? "-" : `#${message.replyTo}`;
      const kind = message.media ?? "text";
      const text =
        message.text === undefined ? "-" : JSON.stringify(message.text);
      return [
        `#${message.id}`,
        `at=${JSON.stringify(message.time)}`,
        `by=${JSON.stringify(message.user)}`,
        `reply=${reply}`,
        `kind=${kind}`,
        `text=${text}`,
      ].join("|");
    }),
  ].join("\n");
}

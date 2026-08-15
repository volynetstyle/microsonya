import type { EvalMessage } from "../types.js";

export function serializeJsonl(messages: EvalMessage[]): string {
  return messages
    .map(({ fixtureThread: _fixtureThread, ...message }) =>
      JSON.stringify(message),
    )
    .join("\n");
}

import { serializeJsonl } from "./jsonl.js";
import { serializeNatural } from "./natural.js";
import { serializePipe } from "./pipe.js";
import { serializePipeV2 } from "./pipeV2.js";
import { serializePipeV3 } from "./pipeV3.js";
import type { EvalMessage, Representation } from "../types.js";

export {
  serializeJsonl,
  serializeNatural,
  serializePipe,
  serializePipeV2,
  serializePipeV3,
};

export function serialize(
  representation: Representation,
  messages: EvalMessage[],
): string {
  switch (representation) {
    case "jsonl":
      return serializeJsonl(messages);
    case "pipe":
      return serializePipe(messages);
    case "pipe-v2":
      return serializePipeV2(messages);
    case "pipe-v3":
      return serializePipeV3(messages);
    case "natural":
      return serializeNatural(messages);
  }
}

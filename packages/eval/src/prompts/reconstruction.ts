import type { Representation } from "../types.js";
import { PIPE_V3_LANGUAGE_GUIDE } from "../serializers/pipeV3.js";

export const RECONSTRUCTION_PROMPT_VERSION = "reconstruction-v1";

export function buildReconstructionPrompt(
  serializedMessages: string,
  representation: Representation,
): string {
  const sections = [
    "Reconstruct the conversational thread graph. Do not summarize, rank importance, or rewrite claims.",
    "Group messages that belong to the same subject/reply thread. A late reply belongs with its parent thread even when other topics intervene.",
    "Put conversational noise or messages with no defensible thread in unassigned.",
    "Assign every message ID exactly once, either to one thread or to unassigned.",
    "Return JSON only with exactly this shape:",
    JSON.stringify(
      {
        threads: [
          { id: "thread-1", title: "Short topic label", messages: [1, 3] },
        ],
        unassigned: [2],
      },
      null,
      2,
    ),
    `Input representation: ${representation}`,
  ];
  if (representation === "pipe-v3") {
    sections.push(
      ["Input language reference:", PIPE_V3_LANGUAGE_GUIDE].join("\n"),
    );
  }
  sections.push("Messages:", serializedMessages);
  return sections.join("\n\n");
}

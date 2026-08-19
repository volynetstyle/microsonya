import {
  buildDiscoursePrompt,
  DISCOURSE_PROMPT_VERSION,
  PIPE_V3_LANGUAGE_GUIDE,
} from "@microsonya/experimental-discourse";
import { PIPE_V2_LANGUAGE_GUIDE } from "../serializers/pipeV2.js";
import type { Representation } from "../types.js";

export const SUMMARIZER_PROMPT_VERSION = DISCOURSE_PROMPT_VERSION;

export function buildSummarizerPrompt(
  serializedMessages: string,
  representation: Representation,
): string {
  const guide =
    representation === "pipe-v2"
      ? PIPE_V2_LANGUAGE_GUIDE
      : representation === "pipe-v3"
        ? PIPE_V3_LANGUAGE_GUIDE
        : undefined;
  return buildDiscoursePrompt(serializedMessages, representation, guide);
}

export function buildDirectSummaryPrompt(
  serializedMessages: string,
  representation: Representation,
): string {
  return [
    "Summarize the Telegram conversation directly. Preserve attribution and cite only source message IDs. Do not invent decisions or leave answered questions open.",
    "Return JSON only, with exactly this shape:",
    JSON.stringify(
      {
        title: "Short title",
        topics: [
          {
            id: "short-kebab-id",
            title: "Topic title",
            claims: [{ text: "Attributed claim", evidence: [17] }],
          },
        ],
        decisions: [{ text: "Settled action", evidence: [18] }],
        openQuestions: [{ text: "Unresolved question", evidence: [19] }],
      },
      null,
      2,
    ),
    `Input representation: ${representation}`,
    "Messages:",
    serializedMessages,
  ].join("\n\n");
}

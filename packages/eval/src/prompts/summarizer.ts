import {
  buildDiscoursePrompt,
  DISCOURSE_PROMPT_VERSION,
  PIPE_V3_LANGUAGE_GUIDE,
} from "@microsonya/discourse";
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

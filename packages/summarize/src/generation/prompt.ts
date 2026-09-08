import type { ChatMessage } from "@microsonya/model";
import type { ConversationWindow } from "@microsonya/shared";
import type { ModelWindowMessageRole } from "../model/prompt.js";
import {
  buildModelInputPrompt,
  buildModelPolicyPrompt,
} from "../model/prompt.js";
import { SUMMARY_COMPOSITION_POLICY } from "./composition.js";
import { buildSummaryContrastExamples } from "./examples.js";
import {
  SUMMARY_INSTRUCTIONS,
  SUMMARY_STREAM_OUTPUT_INSTRUCTIONS,
  SUMMARY_STRUCTURED_OUTPUT_INSTRUCTIONS,
} from "./instructions.js";

export type SummaryOutputMode = "structured" | "plain-text";

export type SummaryPromptVariant = "V0" | "V1" | "V2" | "V3";

export interface SummaryPromptOptions {
  readonly outputMode?: SummaryOutputMode;
  readonly promptVariant?: SummaryPromptVariant;
}

export function buildSummaryPrompt(
  window: ConversationWindow,
  roles?: readonly ModelWindowMessageRole[],
): string {
  return buildSummaryMessages(window, roles)
    .map(({ content }) => content)
    .join("\n\n");
}

export function buildSummaryMessages(
  window: ConversationWindow,
  roles?: readonly ModelWindowMessageRole[],
  options: SummaryPromptOptions = {},
): ChatMessage[] {
  const { outputMode = "structured", promptVariant = "V2" } = options;
  const outputInstructions =
    outputMode === "structured"
      ? SUMMARY_STRUCTURED_OUTPUT_INSTRUCTIONS
      : SUMMARY_STREAM_OUTPUT_INSTRUCTIONS;
  const trustedSections = [
    buildModelPolicyPrompt("SUMMARY_POLICY", SUMMARY_INSTRUCTIONS),
    ...(promptVariant === "V2" || promptVariant === "V3"
      ? [
          `SEMANTIC_COMPOSITION_POLICY_BEGIN\n${SUMMARY_COMPOSITION_POLICY}\nSEMANTIC_COMPOSITION_POLICY_END`,
        ]
      : []),
    outputInstructions,
    ...(promptVariant === "V3"
      ? [buildSummaryContrastExamples(outputMode)]
      : []),
  ].join("\n\n");
  const input = buildModelInputPrompt(window, roles);

  if (promptVariant === "V0") {
    return [{ role: "user", content: `${trustedSections}\n\n${input}` }];
  }

  return [
    { role: "system", content: trustedSections },
    { role: "user", content: input },
  ];
}

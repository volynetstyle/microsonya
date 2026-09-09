import type { ChatMessage } from "@microsonya/model";
import type { ConversationWindow } from "@microsonya/shared";
import type {
  ModelWindowMessageRole,
  ReasoningEffort,
} from "../model/prompt.js";
import {
  buildHarmonySystemMessage,
  buildModelInputPrompt,
  buildModelPolicyPrompt,
} from "../model/prompt.js";
import { SUMMARY_COMPOSITION_POLICY } from "./composition.js";
import { SUMMARY_RESPONSE_SCHEMA } from "./schema.js";
import {
  SUMMARY_INSTRUCTIONS,
  SUMMARY_STREAM_OUTPUT_INSTRUCTIONS,
  SUMMARY_STRUCTURED_OUTPUT_INSTRUCTIONS,
} from "./instructions.js";

export type SummaryOutputMode = "structured" | "plain-text";

export interface SummaryPromptOptions {
  readonly outputMode?: SummaryOutputMode;
  /**
   * gpt-oss / harmony reasoning-effort knob. Default "medium": this task is
   * bounded extraction against a fixed constraint checklist, not open-ended
   * multi-step reasoning — "high" mostly buys latency here until measured
   * otherwise (see note below).
   */
  readonly reasoningEffort?: ReasoningEffort;
  readonly currentDate?: string;
}

function structuredResponseFormat(): string {
  return [
    "# Response Formats",
    "",
    "## summary",
    "",
    "// The final conversation summary.",
    JSON.stringify(SUMMARY_RESPONSE_SCHEMA),
  ].join("\n");
}

export function buildSummaryMessages(
  window: ConversationWindow,
  roles?: readonly ModelWindowMessageRole[],
  options: SummaryPromptOptions = {},
): ChatMessage[] {
  const {
    outputMode = "structured",
    reasoningEffort = "medium",
    currentDate,
  } = options;
  const outputInstructions =
    outputMode === "structured"
      ? SUMMARY_STRUCTURED_OUTPUT_INSTRUCTIONS
      : SUMMARY_STREAM_OUTPUT_INSTRUCTIONS;

  const developerContent = [
    "# Instructions",
    buildModelPolicyPrompt("SUMMARY_POLICY", SUMMARY_INSTRUCTIONS),
    `SEMANTIC_COMPOSITION_POLICY_BEGIN\n${SUMMARY_COMPOSITION_POLICY}\nSEMANTIC_COMPOSITION_POLICY_END`,
    outputInstructions,
    outputMode === "structured" ? structuredResponseFormat() : null,
  ]
    .filter((section): section is string => section !== null)
    .join("\n\n");

  const input = buildModelInputPrompt(window, roles);

  // NB: "developer" as a ChatMessage role isn't defined anywhere in this
  // file — depends on @microsonya/model's role union actually including it,
  // and on the serving stack (vLLM/Ollama/provider) mapping it into
  // harmony's developer message rather than rejecting it as unknown. Verify
  // both before relying on this split; if either doesn't hold, fall back to
  // folding developerContent into the system message as before.
  return [
    {
      role: "system",
      content: `${buildHarmonySystemMessage({ reasoningEffort, currentDate })}\n\n${developerContent}`,
    },
    { role: "user", content: input },
  ];
}

import type { ChatMessage } from "@microsonya/model";
import type { ConversationWindow } from "@microsonya/shared";
import type { ModelWindowMessageRole, ReasoningEffort } from "../model/prompt.js";
import {
  buildHarmonySystemMessage,
  buildModelInputPrompt,
  buildModelPolicyPrompt,
} from "../model/prompt.js";
import { COMPACTION_DECISION_INSTRUCTIONS } from "./instructions.js";
import { CLASSIFIER_RESPONSE_SCHEMA } from "./predicates.js";

export interface ClassifierPromptOptions {
  readonly reasoningEffort?: ReasoningEffort;
  readonly currentDate?: string;
}

function classifierResponseFormat(): string {
  return [
    "# Response Formats",
    "",
    "## classification_predicates",
    "",
    "// Semantic predicates used by deterministic classification policy.",
    JSON.stringify(CLASSIFIER_RESPONSE_SCHEMA),
  ].join("\n");
}

export function buildClassifierMessages(
  window: ConversationWindow,
  roles?: readonly ModelWindowMessageRole[],
  options: ClassifierPromptOptions = {},
): ChatMessage[] {
  const developerContent = [
    "# Instructions",
    buildModelPolicyPrompt("CLASSIFICATION_POLICY", COMPACTION_DECISION_INSTRUCTIONS),
    "Return only JSON matching the required output schema.",
    classifierResponseFormat(),
  ].join("\n\n");

  return [
    {
      role: "system",
      content: `${buildHarmonySystemMessage(options)}\n\n${developerContent}`,
    },
    { role: "user", content: buildModelInputPrompt(window, roles) },
  ];
}

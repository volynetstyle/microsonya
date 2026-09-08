import type { ConversationWindow } from "@microsonya/shared";
import type { ModelWindowMessageRole } from "../model/prompt.js";
import { buildModelPrompt } from "../model/prompt.js";
import { COMPACTION_DECISION_INSTRUCTIONS } from "./instructions.js";

export function buildClassifierPrompt(
  window: ConversationWindow,
  roles?: readonly ModelWindowMessageRole[],
): string {
  return buildModelPrompt(
    "CLASSIFICATION_POLICY",
    COMPACTION_DECISION_INSTRUCTIONS,
    window,
    roles,
  );
}

import type { ConversationWindow } from "@microsonya/shared";
import { encodePipeWindow, PIPE_GUIDE } from "./transcript.js";

export interface ModelWindowMessageRole {
  readonly message: { readonly id: number };
  readonly role: "eligible" | "context";
}

export type ModelPolicySection = "CLASSIFICATION_POLICY" | "SUMMARY_POLICY";

/**
 * gpt-oss / harmony reasoning-effort knob. Trades analysis-channel token
 * budget for adherence to multi-step instructions. See
 * https://developers.openai.com/cookbook/articles/openai-harmony
 */
export type ReasoningEffort = "low" | "medium" | "high";

export interface HarmonySystemMessageOptions {
  readonly reasoningEffort?: ReasoningEffort;
  /** ISO date (YYYY-MM-DD). Omitted unless the caller supplies one —
   *  this function stays pure, no implicit Date.now(). */
  readonly currentDate?: string;
  readonly knowledgeCutoff?: string;
}

/**
 * Harmony's instruction hierarchy is system > developer > user > assistant >
 * tool, and the model was trained expecting `system` to hold model-level
 * config (identity, date, reasoning effort, tool defs) — not app policy.
 * Keep this message short and in-distribution; put actual task policy in a
 * `developer`-role message instead (see buildModelPolicyPrompt below, used
 * from the developer slot in summary/index.ts).
 */
export function buildHarmonySystemMessage(
  options: HarmonySystemMessageOptions = {},
): string {
  const {
    reasoningEffort = "medium",
    currentDate,
    knowledgeCutoff = "2024-06",
  } = options;
  return [
    "You are ChatGPT, a large language model trained by OpenAI.",
    `Knowledge cutoff: ${knowledgeCutoff}`,
    currentDate ? `Current date: ${currentDate}` : null,
    "",
    `Reasoning: ${reasoningEffort}`,
    "",
    "# Valid channels: analysis, commentary, final. Channel must be included for every message.",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

export function buildModelPolicyPrompt(
  policySection: ModelPolicySection,
  policy: string,
): string {
  return `${policySection}_BEGIN\n${policy}\n${policySection}_END\n\nTRANSCRIPT_FORMAT_BEGIN\n${PIPE_GUIDE}\nTRANSCRIPT_FORMAT_END`;
}

export function buildModelInputPrompt(
  window: ConversationWindow,
  roles?: readonly ModelWindowMessageRole[],
): string {
  const roleSection =
    roles === undefined
      ? ""
      : `INPUT_ROLES_BEGIN\n${encodeInputRoles(roles)}\nINPUT_ROLES_END\n\n`;
  return `${roleSection}TRANSCRIPT_BEGIN\n${encodePipeWindow(window)}\nTRANSCRIPT_END`;
}

function encodeInputRoles(roles: readonly ModelWindowMessageRole[]): string {
  return roles.map(({ message, role }) => `#${message.id}|${role}`).join("\n");
}

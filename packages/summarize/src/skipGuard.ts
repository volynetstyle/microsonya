import type {
  ChatMessage,
  ConversationWindow,
  SummaryDecision,
} from "@microsonya/shared";
import type { ModelWindowMessageRole } from "./prompt.js";

export const IRREVERSIBLE_SKIP_GUARD_VERSION = "skip-guard-v0.1";

export type SkipRiskIndicator =
  | "SOURCE_PROVENANCE"
  | "REPLY_RELATION"
  | "NUMERIC_FACT"
  | "DATE_OR_DEADLINE"
  | "SUBSTANTIVE_TEXT"
  | "STATE_CHANGE"
  | "REQUEST_AND_RESULT"
  | "MULTIPLE_CONCRETE_ENTITIES";

export interface IrreversibleSkipGuardResult {
  readonly decision: SummaryDecision;
  readonly vetoed: boolean;
  readonly proposedAction: SummaryDecision["action"];
  readonly reasons: readonly SkipRiskIndicator[];
}

/**
 * One-way safety boundary for checkpoint-advancing SKIP decisions.
 * It can preserve a window for reconsideration, but can never create SUMMARIZE.
 */
export function guardIrreversibleSkip(
  decision: SummaryDecision,
  window: ConversationWindow,
  roles?: readonly ModelWindowMessageRole[],
): IrreversibleSkipGuardResult {
  if (!decision.action.startsWith("SKIP_")) {
    return Object.freeze({
      decision,
      vetoed: false,
      proposedAction: decision.action,
      reasons: Object.freeze([]),
    });
  }

  const eligible = eligibleMessages(window, roles);
  const reasons = detectSkipRisks(eligible);
  if (reasons.length === 0) {
    return Object.freeze({
      decision,
      vetoed: false,
      proposedAction: decision.action,
      reasons,
    });
  }

  return Object.freeze({
    decision: Object.freeze({ ...decision, action: "DEFER_COMPACT" }),
    vetoed: true,
    proposedAction: decision.action,
    reasons,
  });
}

export function detectSkipRisks(
  messages: readonly ChatMessage[],
): readonly SkipRiskIndicator[] {
  const reasons = new Set<SkipRiskIndicator>();
  const text = messages.map(({ text }) => text).join("\n");

  if (messages.some(({ contentSource }) => contentSource !== undefined)) {
    reasons.add("SOURCE_PROVENANCE");
  }
  if (messages.some(({ parentId }) => parentId !== null)) {
    reasons.add("REPLY_RELATION");
  }
  if (/\p{N}/u.test(text)) reasons.add("NUMERIC_FACT");
  if (DATE_OR_DEADLINE.test(text)) reasons.add("DATE_OR_DEADLINE");
  if (
    messages.some(
      ({ text: value }) =>
        value.length >= 180 || value.trim().split(/\s+/u).length >= 32,
    )
  ) {
    reasons.add("SUBSTANTIVE_TEXT");
  }
  if (STATE_CHANGE.test(text)) reasons.add("STATE_CHANGE");
  if (REQUEST.test(text) && RESULT.test(text))
    reasons.add("REQUEST_AND_RESULT");

  const concreteKinds = new Set<string>();
  for (const match of text.matchAll(CONCRETE_ENTITY)) {
    concreteKinds.add(match[0].toLocaleLowerCase("uk"));
  }
  if (concreteKinds.size >= 2) reasons.add("MULTIPLE_CONCRETE_ENTITIES");

  return Object.freeze([...reasons]);
}

function eligibleMessages(
  window: ConversationWindow,
  roles?: readonly ModelWindowMessageRole[],
): readonly ChatMessage[] {
  if (roles === undefined) return window.messages;
  const eligibleIds = new Set(
    roles
      .filter(({ role }) => role === "eligible")
      .map(({ message }) => message.id),
  );
  return window.messages.filter(({ id }) => eligibleIds.has(id));
}

const DATE_OR_DEADLINE =
  /\b(?:deadline|due|today|tomorrow|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday|сьогодні|завтра|вчора|понеділ\w*|вівтор\w*|серед\w*|четвер\w*|п['’]?ятниц\w*|субот\w*|неділ\w*|до\s+\d{1,2}(?::\d{2})?)\b/iu;
const STATE_CHANGE =
  /\b(?:moved|changed|updated|cancelled|canceled|completed|finished|started|blocked|unblocked|approved|rejected|deployed|shipped|delivered|lost|in transit|assembling|перенес\w*|змін\w*|онов\w*|скас\w*|заверш\w*|почал\w*|заблок\w*|схвал\w*|відхил\w*|задепло\w*|відправ\w*|достав\w*|загуб\w*|комплект\w*|у дорозі)\b/iu;
const REQUEST =
  /(?:\?|\b(?:please|request|asked|need|could you|can you|прошу|попрос\w*|треба|потрібно|можеш|зроби\w*)\b)/iu;
const RESULT =
  /\b(?:done|completed|finished|result|fixed|resolved|approved|готов\w*|заверш\w*|зроблен\w*|результат\w*|виправ\w*|виріш\w*|схвал\w*)\b/iu;
const CONCRETE_ENTITY =
  /\b(?:shipment|parcel|order|purchase|incident|task|deploy|migration|release|посил\w*|відправ\w*|замовлен\w*|покуп\w*|інцидент\w*|задач\w*|депло\w*|міграц\w*|реліз\w*)\b/giu;

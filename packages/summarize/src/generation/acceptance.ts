import type { ConversationWindow } from "@microsonya/shared";
import { ModelOutputError } from "../model/output.js";
import type { ModelWindowMessageRole } from "../model/prompt.js";
import { summaryOutputSchema, type SummaryCandidate } from "./schema.js";
import { validateSemanticOutput } from "./validation.js";

export const SUMMARY_SEMANTIC_FAILURES = [
  "FACT_INVENTION",
  "PROVENANCE",
  "ENTITY_BINDING",
  "SPEECH_ACT",
  "EPISTEMIC_STATE",
  "SUPERSESSION",
  "ATTRIBUTION_RENDERING",
] as const;
export type SummarySemanticFailure = (typeof SUMMARY_SEMANTIC_FAILURES)[number];

export class SummaryAcceptanceError extends Error {
  readonly stage = "summarizer" as const;
  readonly detail: string;
  constructor(
    readonly code: SummarySemanticFailure,
    message: string,
    readonly fragmentIndex?: number,
  ) {
    super(`Summary candidate failed ${code}.`);
    this.name = "SummaryAcceptanceError";
    this.detail = message;
  }
}

/** Validate injected candidates as well as provider output. */
export function validateSummaryCandidate(candidate: unknown): SummaryCandidate {
  const result = summaryOutputSchema.safeParse(candidate);
  if (!result.success) {
    throw new ModelOutputError({
      code: "MODEL_OUTPUT_SCHEMA_MISMATCH",
      stage: "summarizer",
      raw: JSON.stringify(candidate) ?? "",
      cause: result.error,
    });
  }
  return result.data;
}

/** L1 only; workflow additionally requires a complete semantic review. */
export function acceptSummaryCandidate(
  input: SummaryCandidate,
  window: ConversationWindow,
  roles?: readonly ModelWindowMessageRole[],
): string {
  const candidate = validateSummaryCandidate(input);
  const messageById = new Map(window.messages.map((m) => [Number(m.id), m]));
  const eligibleIds = new Set(
    roles === undefined
      ? window.messages.map((m) => Number(m.id))
      : roles
          .filter(({ role }) => role === "eligible")
          .map(({ message }) => Number(message.id)),
  );

  for (const [index, fragment] of candidate.fragments.entries()) {
    validateSemanticOutput(fragment.text);
    const evidence = fragment.evidence.map((id) => {
      const message = messageById.get(id);
      if (message === undefined || !eligibleIds.has(id)) {
        throw new SummaryAcceptanceError(
          "PROVENANCE",
          `Fragment ${index} references missing or context-only evidence #${id}.`,
          index,
        );
      }
      return message;
    });
    for (const subject of fragment.subjects) {
      for (const id of subject.evidence) {
        if (
          !fragment.evidence.includes(id) ||
          messageById.get(id)?.author.label !== subject.author
        ) {
          throw new SummaryAcceptanceError(
            "PROVENANCE",
            `Fragment ${index} subject evidence #${id} does not belong to ${subject.author}.`,
            index,
          );
        }
      }
    }
    const numbers = new Set(
      evidence.flatMap(({ text }) => numericAnchors(text)),
    );
    const unsupported = numericAnchors(fragment.text).find(
      (value) => !numbers.has(value),
    );
    if (unsupported !== undefined) {
      throw new SummaryAcceptanceError(
        "FACT_INVENTION",
        `Fragment ${index} contains unsupported numeric anchor ${unsupported}.`,
        index,
      );
    }
  }
  const summary = composeSummary(candidate);
  validateSemanticOutput(summary);
  return summary;
}

export function composeSummary(candidate: SummaryCandidate): string {
  return candidate.fragments.map(({ text }) => text).join(" ");
}

function numericAnchors(text: string): string[] {
  return [...text.matchAll(/\p{N}+(?:[.,:/-]\p{N}+)*/gu)].map(([anchor]) =>
    anchor.replaceAll(",", "."),
  );
}

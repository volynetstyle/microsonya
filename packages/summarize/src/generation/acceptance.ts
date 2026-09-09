import type { ConversationWindow } from "@microsonya/shared";
import type { ModelWindowMessageRole } from "../model/prompt.js";
import type { SummaryCandidate } from "./schema.js";
import { validateSemanticOutput } from "./validation.js";

export const SUMMARY_SEMANTIC_FAILURES = [
  "FACT_INVENTION",
  "PROVENANCE",
  "ENTITY_BINDING",
  "SPEECH_ACT",
  "EPISTEMIC_STATE",
  "SUPERSESSION",
  "UNSUPPORTED_SUMMARY_TEXT",
] as const;

export type SummarySemanticFailure = (typeof SUMMARY_SEMANTIC_FAILURES)[number];

/** A fail-closed runtime rejection at the candidate -> accepted boundary. */
export class SummaryAcceptanceError extends Error {
  readonly stage = "summarizer" as const;

  constructor(
    readonly code: SummarySemanticFailure,
    message: string,
    readonly claimIndex?: number,
  ) {
    super(message);
    this.name = "SummaryAcceptanceError";
  }
}

/**
 * Applies deterministic checks only. Semantic categories that require model
 * judgment remain part of the public failure vocabulary, not fake heuristics.
 */
export function acceptSummaryCandidate(
  candidate: SummaryCandidate,
  window: ConversationWindow,
  roles?: readonly ModelWindowMessageRole[],
): string {
  validateSemanticOutput(candidate.summary);

  const messageById = new Map(
    window.messages.map((message) => [Number(message.id), message]),
  );
  const eligibleIds = new Set(
    roles === undefined
      ? window.messages.map((message) => Number(message.id))
      : roles
          .filter(({ role }) => role === "eligible")
          .map(({ message }) => Number(message.id)),
  );

  for (const [claimIndex, claim] of candidate.claims.entries()) {
    validateSemanticOutput(claim.text);
    const evidence = claim.evidence.map((id) => {
      const message = messageById.get(id);
      if (message === undefined || !eligibleIds.has(id)) {
        throw new SummaryAcceptanceError(
          "PROVENANCE",
          `Claim ${claimIndex} references missing or context-only evidence #${id}.`,
          claimIndex,
        );
      }
      return message;
    });

    if (
      claim.author !== undefined &&
      !evidence.some(({ author }) => author.label === claim.author)
    ) {
      throw new SummaryAcceptanceError(
        "PROVENANCE",
        `Claim ${claimIndex} author is not present in its evidence.`,
        claimIndex,
      );
    }

    const evidenceNumbers = new Set(
      evidence.flatMap(({ text }) => numericAnchors(text)),
    );
    const unsupportedNumber = numericAnchors(claim.text).find(
      (value) => !evidenceNumbers.has(value),
    );
    if (unsupportedNumber !== undefined) {
      throw new SummaryAcceptanceError(
        "FACT_INVENTION",
        `Claim ${claimIndex} contains unsupported numeric anchor ${unsupportedNumber}.`,
        claimIndex,
      );
    }
  }

  const summaryTokens = lexicalTokens(candidate.summary);
  const claimTokens = lexicalTokens(
    candidate.claims.map(({ text }) => text).join(" "),
  );
  if (
    summaryTokens.length !== claimTokens.length ||
    summaryTokens.some((token, index) => token !== claimTokens[index])
  ) {
    throw new SummaryAcceptanceError(
      "UNSUPPORTED_SUMMARY_TEXT",
      "Canonical summary contains text not accounted for by its ordered claims.",
    );
  }

  return candidate.summary;
}

function lexicalTokens(value: string): string[] {
  return [...value.toLocaleLowerCase().matchAll(/[\p{L}\p{N}]+/gu)].map(
    ([token]) => token,
  );
}

function numericAnchors(value: string): string[] {
  return [...value.matchAll(/\p{N}+(?:[.,:/-]\p{N}+)*/gu)].map(([anchor]) =>
    anchor.replaceAll(",", "."),
  );
}

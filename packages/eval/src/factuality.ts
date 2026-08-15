import { z } from "zod";
import type { EvalMessage, ProjectedSummary } from "./types.js";

export const factualityOutputSchema = z
  .object({
    checks: z.array(
      z
        .object({
          itemIndex: z.number().int().nonnegative(),
          question: z.string().min(1),
          candidateAnswer: z.string().min(1),
          sourceAnswer: z.string().min(1).nullable(),
          answerRelation: z.string().min(1),
          verdict: z.string().min(1),
          explanation: z.string().min(1),
        })
        .strict(),
    ),
  })
  .strict();

export type FactualityOutput = z.infer<typeof factualityOutputSchema>;

export type CandidateItem = {
  itemIndex: number;
  category: "claim" | "decision";
  text: string;
  evidence: number[];
};

export function candidateItems(summary: ProjectedSummary): CandidateItem[] {
  return [
    ...summary.topics.flatMap((topic) =>
      topic.claims.map((claim) => ({ category: "claim" as const, ...claim })),
    ),
    ...summary.decisions.map((decision) => ({
      category: "decision" as const,
      ...decision,
    })),
  ].map((item, itemIndex) => ({ itemIndex, ...item }));
}

export function buildFactualityPrompt(
  summary: ProjectedSummary,
  messages: EvalMessage[],
  evidenceMode: "original" | "rotated-evidence" = "original",
): { prompt: string; itemCount: number } {
  const byId = new Map(messages.map((message) => [message.id, message]));
  const candidates = candidateItems(summary);
  const items = candidates.map((item, index) => ({
    ...item,
    evidence:
      evidenceMode === "rotated-evidence" && candidates.length > 1
        ? candidates[(index + 1) % candidates.length]!.evidence
        : item.evidence,
    citedSource: (evidenceMode === "rotated-evidence" && candidates.length > 1
      ? candidates[(index + 1) % candidates.length]!.evidence
      : item.evidence
    ).map((id) => {
      const message = byId.get(id);
      return message
        ? {
            id,
            author: message.user,
            text: message.text ?? `[${message.media ?? "media"}]`,
          }
        : { id, missing: true };
    }),
  }));
  const prompt = [
    "Evaluate factual grounding with a QA comparison. Treat citedSource as the only authority.",
    "For every item: generate one diagnostic question whose answer tests its central factual content; answer it from the candidate item; independently answer it from citedSource; then compare the answers.",
    "Preserve modality and status: plans are not completed actions, questions are not assertions, quoted opinions are not objective facts, and requested prices are not payments.",
    "Use supported/equivalent only when citedSource entails the material subject, predicate, numbers, modality, and status. Use not-enough-evidence/source-insufficient when the source cannot answer. Use contradicted/different when it conflicts.",
    "Return JSON only. Include exactly one check for every itemIndex and no others.",
    "Required shape:",
    JSON.stringify(
      {
        checks: [
          {
            itemIndex: 0,
            question: "Diagnostic question?",
            candidateAnswer: "Answer implied by candidate",
            sourceAnswer: "Answer supported by cited source or null",
            answerRelation: "equivalent",
            verdict: "supported",
            explanation: "Short comparison",
          },
        ],
      },
      null,
      2,
    ),
    "Items:",
    JSON.stringify(items, null, 2),
  ].join("\n\n");
  return { prompt, itemCount: items.length };
}

export function parseFactuality(
  raw: string,
  itemCount: number,
):
  | { ok: true; output: FactualityOutput }
  | { ok: false; validJson: boolean; error: string } {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    return {
      ok: false,
      validJson: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  const parsed = factualityOutputSchema.safeParse(value);
  if (!parsed.success)
    return { ok: false, validJson: true, error: parsed.error.message };
  const indices = parsed.data.checks.map((check) => check.itemIndex);
  const expected = Array.from({ length: itemCount }, (_, index) => index);
  if (
    indices.length !== expected.length ||
    new Set(indices).size !== indices.length ||
    expected.some((index) => !indices.includes(index))
  ) {
    return {
      ok: false,
      validJson: true,
      error: `Expected item indices ${expected.join(",")}; received ${indices.join(",")}`,
    };
  }
  return { ok: true, output: parsed.data };
}

export function scoreFactuality(output: FactualityOutput): {
  nItems: number;
  supportedRate: number | null;
  qaAgreementRate: number | null;
  contradictedRate: number | null;
  insufficientRate: number | null;
  labelValidRate: number | null;
} {
  const n = output.checks.length;
  const rate = (
    predicate: (check: FactualityOutput["checks"][number]) => boolean,
  ) => (n === 0 ? null : output.checks.filter(predicate).length / n);
  return {
    nItems: n,
    supportedRate: rate((check) => label(check.verdict) === "supported"),
    qaAgreementRate: rate(
      (check) => label(check.answerRelation) === "equivalent",
    ),
    contradictedRate: rate((check) => label(check.verdict) === "contradicted"),
    insufficientRate: rate((check) =>
      ["not-enough-evidence", "source-insufficient"].includes(
        label(check.verdict),
      ),
    ),
    labelValidRate: rate(
      (check) =>
        [
          "equivalent",
          "different",
          "source-insufficient",
          "not-enough-evidence",
        ].includes(label(check.answerRelation)) &&
        [
          "supported",
          "contradicted",
          "not-enough-evidence",
          "source-insufficient",
        ].includes(label(check.verdict)),
    ),
  };
}

function label(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‐‑‒–—]/g, "-")
    .replaceAll(" ", "-");
}

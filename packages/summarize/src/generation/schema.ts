import { z } from "zod";

export const SUMMARY_CLAIM_KINDS = [
  "fact",
  "report",
  "opinion",
  "plan",
  "request",
  "decision",
] as const;

export const summaryClaimSchema = z
  .object({
    text: z.string().trim().min(1),
    evidence: z.array(z.number().int().positive()).min(1),
    kind: z.enum(SUMMARY_CLAIM_KINDS),
    author: z.string().trim().min(1).optional(),
  })
  .strict();

export const summaryOutputSchema = z
  .object({
    summary: z.string().trim().min(1),
    claims: z.array(summaryClaimSchema).min(1),
  })
  .strict();

export type SummaryClaim = z.infer<typeof summaryClaimSchema>;
export type SummaryCandidate = z.infer<typeof summaryOutputSchema>;

/** Ollama structured-output contract mirroring {@link summaryOutputSchema}. */
export const SUMMARY_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      minLength: 1,
      description:
        "Canonical prose containing exactly the claim texts, in the same order.",
    },
    claims: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          text: { type: "string", minLength: 1 },
          evidence: {
            type: "array",
            minItems: 1,
            items: { type: "integer", minimum: 1 },
          },
          kind: { type: "string", enum: SUMMARY_CLAIM_KINDS },
          author: { type: "string", minLength: 1 },
        },
        required: ["text", "evidence", "kind"],
        additionalProperties: false,
      },
    },
  },
  required: ["summary", "claims"],
  additionalProperties: false,
} as const;

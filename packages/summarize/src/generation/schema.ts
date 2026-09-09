import { z } from "zod";

const evidenceSchema = z.array(z.number().int().positive()).min(1);
export const summaryFragmentSchema = z
  .object({
    text: z.string().trim().min(1),
    evidence: evidenceSchema,
    subjects: z.array(
      z
        .object({
          author: z.string().trim().min(1),
          evidence: evidenceSchema,
        })
        .strict(),
    ),
  })
  .strict();
export const summaryOutputSchema = z
  .object({
    fragments: z.array(summaryFragmentSchema).min(1),
  })
  .strict();
export type SummaryFragment = z.infer<typeof summaryFragmentSchema>;
export type SummaryCandidate = z.infer<typeof summaryOutputSchema>;

const evidenceJsonSchema = {
  type: "array",
  minItems: 1,
  items: { type: "integer", minimum: 1 },
} as const;
/** Provider grammar and runtime validation describe the same candidate. */
export const SUMMARY_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    fragments: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          text: { type: "string", minLength: 1 },
          evidence: evidenceJsonSchema,
          subjects: {
            type: "array",
            items: {
              type: "object",
              properties: {
                author: { type: "string", minLength: 1 },
                evidence: evidenceJsonSchema,
              },
              required: ["author", "evidence"],
              additionalProperties: false,
            },
          },
        },
        required: ["text", "evidence", "subjects"],
        additionalProperties: false,
      },
    },
  },
  required: ["fragments"],
  additionalProperties: false,
} as const;

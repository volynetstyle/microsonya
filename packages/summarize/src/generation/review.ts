import { z } from "zod";
import { ModelOutputError } from "../model/output.js";
import {
  SUMMARY_SEMANTIC_FAILURES,
  SummaryAcceptanceError,
} from "./acceptance.js";
import type { SummaryCandidate } from "./schema.js";

export const summaryReviewSchema = z
  .object({
    fragments: z
      .array(
        z
          .object({
            index: z.number().int().nonnegative(),
            failures: z.array(
              z
                .object({
                  code: z.enum(SUMMARY_SEMANTIC_FAILURES),
                  reason: z.string().trim().min(1),
                })
                .strict(),
            ),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
export type SummaryReview = z.infer<typeof summaryReviewSchema>;
export const SUMMARY_REVIEW_SCHEMA = {
  type: "object",
  properties: {
    fragments: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          index: { type: "integer", minimum: 0 },
          failures: {
            type: "array",
            items: {
              type: "object",
              properties: {
                code: { type: "string", enum: SUMMARY_SEMANTIC_FAILURES },
                reason: { type: "string", minLength: 1 },
              },
              required: ["code", "reason"],
              additionalProperties: false,
            },
          },
        },
        required: ["index", "failures"],
        additionalProperties: false,
      },
    },
  },
  required: ["fragments"],
  additionalProperties: false,
} as const;

/** Fail closed on missing, repeated, out-of-range or malformed verdicts. */
export function acceptSummaryReview(
  input: SummaryReview,
  candidate: SummaryCandidate,
): void {
  const parsed = summaryReviewSchema.safeParse(input);
  const indices = parsed.success
    ? parsed.data.fragments.map(({ index }) => index)
    : [];
  if (
    !parsed.success ||
    indices.length !== candidate.fragments.length ||
    new Set(indices).size !== indices.length ||
    indices.some((index) => index >= candidate.fragments.length)
  ) {
    throw new ModelOutputError({
      stage: "reviewer",
      code: "MODEL_OUTPUT_SCHEMA_MISMATCH",
      raw: JSON.stringify(input) ?? "",
      cause: parsed.success ? undefined : parsed.error,
    });
  }
  for (const { index, failures } of parsed.data.fragments) {
    const failure = failures[0];
    if (failure)
      throw new SummaryAcceptanceError(failure.code, failure.reason, index);
  }
}

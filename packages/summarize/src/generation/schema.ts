import { z } from "zod";

export const summaryOutputSchema = z
  .object({
    summary: z.string().trim().min(1),
  })
  .strict();

/** Ollama structured-output contract mirroring {@link summaryOutputSchema}. */
export const SUMMARY_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      minLength: 1,
    },
  },
  required: ["summary"],
  additionalProperties: false,
};

import {
  discourseReconstructionSchema,
  projectedSummarySchema,
  type DiscourseReconstruction,
  type ProjectedSummary,
} from "@microsonya/experimental-discourse";

export type ReconstructionParseResult =
  | { validJson: false; schemaValid: false; parsed: null; error: string }
  | { validJson: true; schemaValid: false; parsed: null; error: string }
  | { validJson: true; schemaValid: true; parsed: DiscourseReconstruction };

export function parseDiscourseReconstruction(
  raw: string,
): ReconstructionParseResult {
  let value: unknown;
  try {
    value = JSON.parse(raw.trim());
  } catch (error) {
    return {
      validJson: false,
      schemaValid: false,
      parsed: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const result = discourseReconstructionSchema.safeParse(value);
  if (!result.success) {
    return {
      validJson: true,
      schemaValid: false,
      parsed: null,
      error: result.error.issues
        .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
        .join("; "),
    };
  }
  return { validJson: true, schemaValid: true, parsed: result.data };
}

export type SummaryParseResult =
  | { validJson: false; schemaValid: false; parsed: null; error: string }
  | { validJson: true; schemaValid: false; parsed: null; error: string }
  | { validJson: true; schemaValid: true; parsed: ProjectedSummary };

export function parseProjectedSummary(raw: string): SummaryParseResult {
  let value: unknown;
  try {
    value = JSON.parse(raw.trim());
  } catch (error) {
    return {
      validJson: false,
      schemaValid: false,
      parsed: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  const result = projectedSummarySchema.safeParse(value);
  if (!result.success) {
    return {
      validJson: true,
      schemaValid: false,
      parsed: null,
      error: result.error.issues
        .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
        .join("; "),
    };
  }
  return { validJson: true, schemaValid: true, parsed: result.data };
}

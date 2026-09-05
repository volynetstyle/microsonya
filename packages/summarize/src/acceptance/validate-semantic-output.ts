import { ModelOutputError } from "../evaluation/model-output.js";

/** Semantic acceptance is independent of the destination's size limit. */
export function validateSemanticOutput(text: string): void {
  if (text.trim().length === 0) {
    throw new ModelOutputError({
      code: "MODEL_OUTPUT_EMPTY",
      stage: "summarizer",
      raw: text,
    });
  }
  if (/\u0000/u.test(text) || /<\/?(?:system|assistant|tool)>/iu.test(text)) {
    throw new ModelOutputError({
      code: "MODEL_OUTPUT_SCHEMA_MISMATCH",
      stage: "summarizer",
      raw: text,
    });
  }
}

import { describe, expect, it } from "vitest";
import {
  ModelOutputError,
  validateSemanticOutput,
} from "../packages/summarize/src/index.js";

describe("summary generation output boundary", () => {
  it("accepts final prose", () => {
    expect(() => validateSemanticOutput("Реліз перенесли на четвер.")).not.toThrow();
  });

  it.each(["", "<|channel|>analysis", "<|return|>", "<assistant>secret"])(
    "rejects empty or leaked protocol output: %s",
    (output) => {
      expect(() => validateSemanticOutput(output)).toThrow(ModelOutputError);
    },
  );
});

import { describe, expect, it } from "vitest";
import { OllamaError } from "../packages/model/src/index.js";
import {
  classifySummaryError,
  ModelOutputError,
} from "../packages/summarize/src/index.js";

describe("summary 0.1 error taxonomy", () => {
  it.each([
    [
      new DOMException("timed out", "TimeoutError"),
      "window.process",
      "MODEL_TIMEOUT",
    ],
    [
      new OllamaError("provider unavailable", 503),
      "window.process",
      "MODEL_PROVIDER_ERROR",
    ],
    [
      new ModelOutputError({
        code: "MODEL_OUTPUT_EMPTY",
        stage: "classifier",
        raw: "",
      }),
      "classifier.output",
      "MODEL_OUTPUT_EMPTY",
    ],
    [
      new ModelOutputError({
        code: "MODEL_OUTPUT_INVALID_JSON",
        stage: "summarizer",
        raw: "not-json",
      }),
      "summarizer.output",
      "MODEL_OUTPUT_INVALID",
    ],
    [new Error("database unavailable"), "disposition.save", "STORAGE_ERROR"],
    [new Error("Telegram unavailable"), "delivery", "DELIVERY_ERROR"],
  ] as const)("maps %s at %s to %s", (error, stage, expected) => {
    expect(classifySummaryError(error, stage)).toBe(expected);
  });
});

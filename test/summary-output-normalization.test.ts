import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  ModelOutputError,
  parseSummaryModelOutput,
} from "../packages/summarize/src/index.js";

const schema = z.object({ summary: z.string().min(1) }).strict();

describe("summarizer output normalization", () => {
  it("accepts the strict structured envelope", () => {
    expect(parse('{"summary":"Release moved."}')).toEqual({
      summary: "Release moved.",
      outputEnvelope: "structured",
    });
  });

  it("accepts non-empty plain text as a summarizer-only fallback", () => {
    expect(parse("  Release moved.  ")).toEqual({
      summary: "Release moved.",
      outputEnvelope: "plaintext_fallback",
    });
  });

  it.each(["{broken", "[broken"])(
    "fails closed for JSON-looking invalid output: %s",
    (raw) => {
      const error = capture(raw);
      expect(error).toBeInstanceOf(ModelOutputError);
      expect(error).toMatchObject({ code: "MODEL_OUTPUT_INVALID_JSON" });
    },
  );

  it("fails closed when valid JSON has the wrong schema", () => {
    const error = capture('{"text":"Release moved."}');
    expect(error).toBeInstanceOf(ModelOutputError);
    expect(error).toMatchObject({ code: "MODEL_OUTPUT_SCHEMA_MISMATCH" });
  });
});

function parse(raw: string) {
  return parseSummaryModelOutput({
    raw,
    schema,
    model: "test",
    durationMs: 1,
    telemetry: { record: vi.fn() } as never,
  });
}

function capture(raw: string): unknown {
  try {
    parse(raw);
    return undefined;
  } catch (error) {
    return error;
  }
}

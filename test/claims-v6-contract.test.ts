import { describe, expect, it } from "vitest";
import {
  buildClaimsPrompt,
  claimsReconstructionSchema,
  renderedSummarySchema,
} from "../packages/discourse/src/index.js";
import { buildFinalRenderPrompt } from "../packages/summarize/src/rendering/final-render.js";

describe("two-stage summary contracts", () => {
  it("keeps extraction independent from user-facing rendering", () => {
    const prompt = buildClaimsPrompt("PIPECHAT/3", "pipe-v3");
    expect(prompt).toContain('"claims"');
    expect(prompt).not.toContain('"summary"');
    expect(prompt).not.toContain('"title"');
    expect(
      claimsReconstructionSchema.safeParse({
        claims: [{ topic: "Тема", text: "Твердження", evidence: [17] }],
      }).success,
    ).toBe(true);
  });

  it("renders selected episodes through a separate strict contract", () => {
    const prompt = buildFinalRenderPrompt([
      {
        topic: "Тема",
        claims: [{ topic: "Тема", text: "Твердження", evidence: [17] }],
      },
    ]);
    expect(prompt).toContain('"summary"');
    expect(prompt).toContain("Коротко:");
    expect(prompt).toContain("minimum sufficient representation");
    expect(prompt).toContain("Не переказуй послідовність реплік");
    expect(prompt).toContain("найвища оцінка");
    expect(prompt).toContain("Не виводь причинність");
    expect(prompt).not.toContain(
      "Не намагайся зробити відповідь максимально короткою",
    );
    expect(
      renderedSummarySchema.safeParse({
        title: "Розмова",
        summary: "Коротко: природний переказ розмови.",
      }).success,
    ).toBe(true);
  });
});

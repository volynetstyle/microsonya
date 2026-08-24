import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCompactionPrompt,
  compactionFixtureSchema,
  parseCompactionAction,
} from "../experimental/eval/src/compaction.js";

describe("compaction action eval fixtures", () => {
  it("keeps decision boundaries explicit and strictly parseable", async () => {
    const fixtures = compactionFixtureSchema.parse(
      JSON.parse(
        await readFile(
          path.join(
            process.cwd(),
            "experimental",
            "eval",
            "cases",
            "compaction-boundaries.json",
          ),
          "utf8",
        ),
      ),
    );

    expect(fixtures).toHaveLength(10);
    expect(new Set(fixtures.map((fixture) => fixture.expected))).toEqual(
      new Set([
        "SUMMARIZE",
        "DEFER_COMPACT",
        "DEFER_INCOMPLETE",
        "DEFER_CONTEXT",
        "SKIP_BANTER",
        "SKIP_REACTIONS",
        "SKIP_NO_VALUE",
      ]),
    );
    const prompt = buildCompactionPrompt(fixtures[0]!);
    expect(prompt).toContain("senior coffee engineer");
    expect(prompt).toContain("Stop at the first matching rule.");
    expect(prompt).toContain("Stripe production access is pending.");
    expect(prompt).toContain("Not to option two");
    expect(prompt).toContain('"action":"SKIP_REACTIONS"');
    expect(prompt).toContain("vague problem, proposal, assessment, or topic");
    expect(prompt).toContain("unverified hypothesis");
    expect(prompt).toContain("Renderer invariants");
    expect(prompt).toContain("Є два варіанти. Зараз напишу.");
    expect(prompt).toContain("Migration запускаємо в середу ввечері");
    expect(prompt).toContain("technical defect");
    expect(prompt).toContain("materially shorter or clearer model");
    expect(prompt).toContain("fallback or rollback conditions");
    expect(prompt).toContain("unresolved aliases or pronouns");
    expect(prompt).toContain("retirement lifecycle");
    expect(prompt).toContain("optional name");
    expect(prompt).toContain("two semantic phases");
    expect(parseCompactionAction('{"action":"SUMMARIZE"}')).toBe("SUMMARIZE");
    expect(
      parseCompactionAction('```json\n{"action":"SUMMARIZE"}\n```'),
    ).toBeNull();
    expect(parseCompactionAction('{"action":"UNKNOWN"}')).toBeNull();
  });
});

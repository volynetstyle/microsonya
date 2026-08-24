import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compactionFixtureSchema } from "../experimental/eval/src/compaction.js";

describe("adversarial compaction boundary fixtures", () => {
  it("contains complete, minimally contrasted fixture pairs", async () => {
    const fixtures = compactionFixtureSchema.parse(
      JSON.parse(
        await readFile(
          path.join(
            process.cwd(),
            "experimental",
            "eval",
            "cases",
            "compaction-boundaries-adversarial.json",
          ),
          "utf8",
        ),
      ),
    );
    expect(fixtures).toHaveLength(18);
    expect(new Set(fixtures.map((fixture) => fixture.id)).size).toBe(18);
    const prefixes = fixtures.map((fixture) =>
      fixture.id.replace(
        /-(pure|hidden-decision|real-action|vague|concrete-pending|unresolved-aliases|locally-resolved-aliases|confident-opening|verified-result|long-single-status|connected-rollout-model|compact-contract|contract-with-migration|single-with-noise|multi-stage-release|social|concrete-result)$/,
        "",
      ),
    );
    expect(new Set(prefixes)).toHaveLength(9);
    for (const prefix of new Set(prefixes)) {
      expect(prefixes.filter((candidate) => candidate === prefix)).toHaveLength(
        2,
      );
    }
  });
});

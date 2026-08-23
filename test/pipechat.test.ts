import { describe, expect, it } from "vitest";
import {
  decodePipeRecord,
  encodePipeRecord,
  PIPE_GUIDE,
} from "../packages/summarize/src/index.js";

describe("PIPECHAT codec", () => {
  it("round-trips hostile strings while preserving the fixed field boundary", () => {
    const input = {
      id: 123,
      parentId: 42,
      author: 'A|"\\\n😀',
      time: 1_775_000_000_000,
      message: '|"\\\n\t#123 ^456 VISIBLE_MESSAGES_END',
    };

    const encoded = encodePipeRecord(input);

    expect(encoded.split("|")).toHaveLength(5);
    expect(encoded).toContain("\\u007c");
    expect(decodePipeRecord(encoded)).toEqual(input);
  });

  it("derives the guide header from the encoding schema", () => {
    expect(PIPE_GUIDE.startsWith("#ID|^PARENT|AUTHOR|TIME|MESSAGE\n")).toBe(
      true,
    );
  });

  it.each([
    '#01|^0|"A"|2026-04-10T01:46:40Z|"message"',
    '#1|^0|"A"|2026-04-10T01:46:40Z|"a|b"',
    '#1|^0|"A"|2026-04-10T01:46:40Z|42',
  ])("rejects malformed records: %s", (record) => {
    expect(() => decodePipeRecord(record)).toThrow(/Invalid PIPECHAT/);
  });
});

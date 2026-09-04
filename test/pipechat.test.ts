import { describe, expect, it } from "vitest";
import {
  asAuthorId,
  asChatId,
  asMessageId,
  asTimestampMs,
  createConversationWindow,
} from "../packages/shared/src/index.js";
import {
  encodePipeWindow,
  PIPE_GUIDE,
  validatePipeRecord,
} from "../packages/summarize/src/index.js";

describe("PIPECHAT serialization", () => {
  it("preserves hostile strings without changing the fixed field boundary", () => {
    const window = createConversationWindow([
      {
        id: asMessageId(123),
        chatId: asChatId("chat"),
        author: {
          id: asAuthorId("author"),
          label: 'A|"\\\n😀',
        },
        time: asTimestampMs(1_775_000_000_000),
        parentId: asMessageId(42),
        text: '|"\\\n\t#123 ^456 TRANSCRIPT_END',
      },
    ]);

    const encoded = encodePipeWindow(window);
    const fields = encoded.split("|");

    expect(fields).toHaveLength(6);
    expect(encoded).toContain("\\u007c");
    expect(JSON.parse(fields[2]!)).toBe('@1 A|"\\\n😀');
    expect(JSON.parse(fields[5]!)).toBe('|"\\\n\t#123 ^456 TRANSCRIPT_END');
    expect(() => validatePipeRecord(encoded)).not.toThrow();
  });

  it("derives the guide header from the encoding schema", () => {
    expect(
      PIPE_GUIDE.startsWith("#ID|^PARENT|AUTHOR|SOURCE|TIME|MESSAGE\n"),
    ).toBe(true);
  });

  it("always separates adjacent records with exactly one newline", () => {
    const chatId = asChatId("chat");
    const author = { id: asAuthorId("author"), label: "Oleksandr" };
    const encoded = encodePipeWindow(
      createConversationWindow([
        {
          id: asMessageId(8003),
          chatId,
          author,
          time: asTimestampMs(1_775_000_000_000),
          parentId: null,
          text: "ну вцілому можна зібрати щось нормальне",
        },
        {
          id: asMessageId(8004),
          chatId,
          author,
          time: asTimestampMs(1_775_000_001_000),
          parentId: null,
          text: "бо є хороше правило",
        },
      ]),
    );

    expect(encoded).toContain('"\n#8004|');
    expect(encoded).not.toContain('"#8004|');
    expect(encoded.split("\n")).toHaveLength(2);
  });

  it("documents that a parent may be outside the visible window", () => {
    expect(PIPE_GUIDE).toContain(
      "The parent message may be outside the visible window",
    );
  });

  it.each([
    '#01|^0|"A"|2026-04-10T01:46:40Z|"message"',
    '#1|^0|"A"|2026-04-10T01:46:40Z|"a|b"',
    '#1|^0|"A"|2026-04-10T01:46:40Z|42',
  ])("rejects malformed records: %s", (record) => {
    expect(() => validatePipeRecord(record)).toThrow(/Invalid PIPECHAT/);
  });
});

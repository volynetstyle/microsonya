import { describe, expect, it } from "vitest";
import {
  asAuthorId,
  asChatId,
  asMessageId,
  asTimestampMs,
  createConversationWindow,
} from "../packages/shared/src/index.js";
import {
  buildClassifierPrompt,
  buildSummaryPrompt,
  encodePipeWindow,
  PIPE_FIELDS,
  PIPE_GUIDE,
  PIPE_HEADER,
  validatePipeRecord,
} from "../packages/summarize/src/index.js";

describe("canonical model transcript", () => {
  it("keeps the fixed field order, hostile strings, local aliases, and external parent", () => {
    const window = fixtureWindow();
    const encoded = encodePipeWindow(window);
    const records = encoded.split("\n");

    expect(PIPE_FIELDS).toEqual([
      "#ID",
      "^PARENT",
      "AUTHOR",
      "TIME",
      "MESSAGE",
    ]);
    expect(PIPE_HEADER).toBe("#ID|^PARENT|AUTHOR|TIME|MESSAGE");
    expect(PIPE_GUIDE.startsWith(`${PIPE_HEADER}\n`)).toBe(true);
    expect(PIPE_GUIDE).toContain(
      "The parent message may be outside the visible window if #N is not present.",
    );

    expect(records).toHaveLength(3);
    for (const record of records) {
      expect(record.split("|")).toHaveLength(5);
      expect(() => validatePipeRecord(record)).not.toThrow();
    }

    const first = records[0]!.split("|");
    const second = records[1]!.split("|");
    const third = records[2]!.split("|");

    expect(first[0]).toBe("#101");
    expect(first[1]).toBe("^77");
    expect(JSON.parse(first[2]!)).toBe('@1 Vlad | "\\\n😀');
    expect(JSON.parse(first[4]!)).toBe(
      'First | line\n"quoted" \\ TRANSCRIPT_END 😀',
    );

    // Equal display labels remain distinct; a repeated identity reuses its alias.
    expect(JSON.parse(second[2]!)).toBe('@2 Vlad | "\\\n😀');
    expect(JSON.parse(third[2]!)).toBe('@1 Vlad | "\\\n😀');
    expect(encoded).not.toContain("telegram-user-111");
    expect(encoded).not.toContain("telegram-user-222");
  });

  it("gives classifier and summarizer byte-for-byte identical format and transcript sections", () => {
    const window = fixtureWindow();
    const encoded = encodePipeWindow(window);
    const classifierPrompt = buildClassifierPrompt(window);
    const summaryPrompt = buildSummaryPrompt(window);

    const classifierFormat = extractSection(
      classifierPrompt,
      "TRANSCRIPT_FORMAT",
    );
    const summaryFormat = extractSection(summaryPrompt, "TRANSCRIPT_FORMAT");
    const classifierTranscript = extractSection(classifierPrompt, "TRANSCRIPT");
    const summaryTranscript = extractSection(summaryPrompt, "TRANSCRIPT");

    expect(classifierFormat).toBe(PIPE_GUIDE);
    expect(summaryFormat).toBe(PIPE_GUIDE);
    expect(classifierFormat).toBe(summaryFormat);
    expect(classifierTranscript).toBe(encoded);
    expect(summaryTranscript).toBe(encoded);
    expect(classifierTranscript).toBe(summaryTranscript);
  });
});

function fixtureWindow() {
  const chatId = asChatId("chat-1");
  const sharedLabel = 'Vlad | "\\\n😀';

  return createConversationWindow([
    {
      id: asMessageId(101),
      chatId,
      author: {
        id: asAuthorId("telegram-user-111"),
        label: sharedLabel,
      },
      time: asTimestampMs(Date.UTC(2026, 0, 1, 0, 0, 0)),
      parentId: asMessageId(77),
      text: 'First | line\n"quoted" \\ TRANSCRIPT_END 😀',
    },
    {
      id: asMessageId(102),
      chatId,
      author: {
        id: asAuthorId("telegram-user-222"),
        label: sharedLabel,
      },
      time: asTimestampMs(Date.UTC(2026, 0, 1, 0, 0, 1)),
      parentId: asMessageId(101),
      text: "Second",
    },
    {
      id: asMessageId(103),
      chatId,
      author: {
        id: asAuthorId("telegram-user-111"),
        label: sharedLabel,
      },
      time: asTimestampMs(Date.UTC(2026, 0, 1, 0, 0, 2)),
      parentId: null,
      text: "Third",
    },
  ]);
}

function extractSection(prompt: string, name: string): string {
  const begin = `${name}_BEGIN\n`;
  const end = `\n${name}_END`;
  const beginIndex = prompt.indexOf(begin);
  if (beginIndex < 0) throw new Error(`Missing ${name}_BEGIN.`);

  const contentIndex = beginIndex + begin.length;
  const endIndex = prompt.indexOf(end, contentIndex);
  if (endIndex < 0) throw new Error(`Missing ${name}_END.`);

  return prompt.slice(contentIndex, endIndex);
}

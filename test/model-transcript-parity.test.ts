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
  buildClassifierInputPrompt,
  buildSummaryMessages,
  buildSummaryInputPrompt,
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
      "SOURCE",
      "TIME",
      "MESSAGE",
    ]);
    expect(PIPE_HEADER).toBe("#ID|^PARENT|AUTHOR|SOURCE|TIME|MESSAGE");
    expect(PIPE_GUIDE.startsWith(`${PIPE_HEADER}\n`)).toBe(true);
    expect(PIPE_GUIDE).toContain(
      "The parent message may be outside the visible window if #N is not present.",
    );

    expect(records).toHaveLength(3);
    for (const record of records) {
      expect(record.split("|")).toHaveLength(6);
      expect(() => validatePipeRecord(record)).not.toThrow();
    }

    const first = records[0]!.split("|");
    const second = records[1]!.split("|");
    const third = records[2]!.split("|");

    expect(first[0]).toBe("#101");
    expect(first[1]).toBe("^77");
    expect(JSON.parse(first[2]!)).toBe('@1 Vlad | "\\\n😀');
    expect(JSON.parse(first[5]!)).toBe(
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

  it("keeps trusted summary policy in system and untrusted transcript in user", () => {
    const window = fixtureWindow();
    const messages = buildSummaryMessages(
      window,
      [
        { message: window.messages[0]!, role: "context" },
        { message: window.messages[1]!, role: "eligible" },
        { message: window.messages[2]!, role: "eligible" },
      ],
      { promptVariant: "V3" },
    );

    expect(messages.map(({ role }) => role)).toEqual(["system", "user"]);
    expect(messages[0]!.content).toContain("SUMMARY_POLICY_BEGIN");
    expect(messages[0]!.content).toContain("TRANSCRIPT_FORMAT_BEGIN");
    expect(messages[0]!.content).toContain("SEMANTIC_COMPOSITION_POLICY_BEGIN");
    expect(messages[0]!.content).toContain("SEMANTIC_CONTRAST_EXAMPLES_BEGIN");
    expect(messages[0]!.content).toContain(
      'Correct final output:\n{"summary":"Реліз перенесли на четвер.',
    );
    expect(messages[0]!.content).toContain(
      "Do not fuse propositions from different speakers",
    );
    expect(messages[0]!.content).not.toContain("TRANSCRIPT_BEGIN");
    expect(messages[0]!.content).not.toContain("First | line");

    expect(messages[1]!.content).toContain("INPUT_ROLES_BEGIN");
    expect(messages[1]!.content).toContain("#101|context");
    expect(messages[1]!.content).toContain("TRANSCRIPT_BEGIN");
    expect(messages[1]!.content).toContain("First \\u007c line");
    expect(messages[1]!.content).not.toContain("SUMMARY_POLICY_BEGIN");
    expect(messages[1]!.content).not.toContain(
      "SEMANTIC_COMPOSITION_POLICY_BEGIN",
    );
    expect(messages[1]!.content).not.toContain("REPLY_CONTEXT_CAPSULES_BEGIN");
  });

  it("contains reply capsules only in the classifier representation", () => {
    const window = fixtureWindow();
    const roles = [
      { message: window.messages[0]!, role: "context" as const },
      { message: window.messages[1]!, role: "eligible" as const },
      { message: window.messages[2]!, role: "eligible" as const },
    ];

    const classifier = buildClassifierInputPrompt(window, roles);
    const summarizer = buildSummaryInputPrompt(window, roles);

    expect(classifier).toContain("REPLY_CONTEXT_CAPSULES_BEGIN");
    expect(summarizer).not.toContain("REPLY_CONTEXT_CAPSULES_BEGIN");
    expect(summarizer.match(/#101\|\^77\|/gu)).toHaveLength(1);
    expect(summarizer.match(/#102\|\^101\|/gu)).toHaveLength(1);
  });

  it("uses PIPECHAT aliases unchanged in reply capsules", () => {
    const window = fixtureWindow();
    const roles = [
      { message: window.messages[0]!, role: "context" as const },
      { message: window.messages[1]!, role: "eligible" as const },
      { message: window.messages[2]!, role: "eligible" as const },
    ];

    const classifier = buildClassifierInputPrompt(window, roles);

    expect(classifier).toContain('PARENT_AUTHOR "@1 Vlad');
    expect(classifier).toContain('CHILD_AUTHOR "@2 Vlad');
    expect(classifier).not.toContain("telegram-user-111");
    expect(classifier).not.toContain("telegram-user-222");
  });

  it("uses a plain-text output contract only for progressive streaming", () => {
    const window = fixtureWindow();
    const structured = buildSummaryMessages(window, undefined, {
      promptVariant: "V3",
    });
    const streaming = buildSummaryMessages(window, undefined, {
      outputMode: "plain-text",
      promptVariant: "V3",
    });

    expect(structured[0]!.content).toContain(
      "Return only JSON matching the required output schema.",
    );
    expect(streaming[0]!.content).toContain(
      "Return only the summary as plain text.",
    );
    expect(streaming[0]!.content).not.toContain(
      "Return only JSON matching the required output schema.",
    );
    expect(streaming[0]!.content).toContain(
      "Correct final output:\nРеліз перенесли на четвер.",
    );
    expect(streaming[0]!.content).not.toContain(
      'Correct final output:\n{"summary":',
    );
    expect(streaming[1]!.content).toBe(structured[1]!.content);
  });

  it("exposes the V0-V3 ablation matrix while defaulting to proven V2", () => {
    const window = fixtureWindow();
    const variants = (["V0", "V1", "V2", "V3"] as const).map(
      (promptVariant) => ({
        promptVariant,
        messages: buildSummaryMessages(window, undefined, { promptVariant }),
      }),
    );

    expect(
      variants.map(({ messages }) => messages.map(({ role }) => role)),
    ).toEqual([
      ["user"],
      ["system", "user"],
      ["system", "user"],
      ["system", "user"],
    ]);
    expect(variants[0]!.messages[0]!.content).not.toContain(
      "SEMANTIC_COMPOSITION_POLICY_BEGIN",
    );
    expect(variants[1]!.messages[0]!.content).not.toContain(
      "SEMANTIC_COMPOSITION_POLICY_BEGIN",
    );
    expect(variants[2]!.messages[0]!.content).toContain(
      "SEMANTIC_COMPOSITION_POLICY_BEGIN",
    );
    expect(variants[2]!.messages[0]!.content).not.toContain(
      "SEMANTIC_CONTRAST_EXAMPLES_BEGIN",
    );
    expect(variants[3]!.messages[0]!.content).toContain(
      "SEMANTIC_CONTRAST_EXAMPLES_BEGIN",
    );
    expect(buildSummaryMessages(window)).toEqual(variants[2]!.messages);
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

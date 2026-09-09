import { describe, expect, it } from "vitest";
import {
  asAuthorId,
  asChatId,
  asMessageId,
  asTimestampMs,
  createConversationWindow,
} from "../packages/shared/src/index.js";
import {
  buildClassifierMessages,
  buildSummaryMessages,
  encodePipeWindow,
  PIPE_FIELDS,
  PIPE_GUIDE,
  PIPE_HEADER,
  validatePipeRecord,
} from "../packages/summarize/src/index.js";

describe("canonical model transcript", () => {
  it("keeps the fixed field order, hostile strings, visible names, and external parent", () => {
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
    expect(JSON.parse(first[2]!)).toBe('Vlad | "\\\n😀');
    expect(JSON.parse(first[4]!)).toBe(
      'First | line\n"quoted" \\ TRANSCRIPT_END 😀',
    );

    // The model sees exactly the visible attribution and no synthetic IDs.
    expect(JSON.parse(second[2]!)).toBe('Vlad | "\\\n😀');
    expect(JSON.parse(third[2]!)).toBe('Vlad | "\\\n😀');
    expect(encoded).not.toMatch(/@\d+/u);
    expect(encoded).not.toContain("telegram-user-111");
    expect(encoded).not.toContain("telegram-user-222");
  });

  it("gives classifier and summarizer byte-for-byte identical format and transcript sections", () => {
    const window = fixtureWindow();
    const encoded = encodePipeWindow(window);
    const classifierPrompt = buildClassifierMessages(window)
      .map(({ content }) => content)
      .join("\n\n");
    const summaryMessages = buildSummaryMessages(window);
    const summaryPrompt = summaryMessages
      .map(({ content }) => content)
      .join("\n\n");

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
      { currentDate: "2026-09-09", reasoningEffort: "low" },
    );

    expect(messages.map(({ role }) => role)).toEqual(["system", "user"]);
    expect(messages[0]!.content).toContain("You are ChatGPT");
    expect(messages[0]!.content).toContain("Current date: 2026-09-09");
    expect(messages[0]!.content).toContain("SUMMARY_POLICY_BEGIN");
    expect(messages[0]!.content).toContain("TRANSCRIPT_FORMAT_BEGIN");
    expect(messages[0]!.content).toContain("SEMANTIC_COMPOSITION_POLICY_BEGIN");
    expect(messages[0]!.content).not.toContain(
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
  });

  it("has one grounded fragment contract without a duplicate summary field", () => {
    const window = fixtureWindow();
    const structured = buildSummaryMessages(window);

    expect(structured[0]!.content).toContain(
      "Return only JSON with grounded prose fragments",
    );
    expect(structured[0]!.content).toContain("not atomic claims");
    expect(structured[0]!.content).toContain('"fragments"');
    expect(structured[0]!.content).not.toContain('"claims"');
    expect(structured[0]!.content).not.toContain(
      "Return only the summary as plain text",
    );
  });

  it("changes only the declared reasoning line across low, medium, and high", () => {
    const variants = (["low", "medium", "high"] as const).map((effort) =>
      buildSummaryMessages(fixtureWindow(), undefined, {
        currentDate: "2026-09-09",
        reasoningEffort: effort,
      }),
    );

    expect(variants.map((messages) => messages[1]!.content)).toEqual([
      variants[0]![1]!.content,
      variants[0]![1]!.content,
      variants[0]![1]!.content,
    ]);
    expect(
      variants.map((messages) =>
        messages[0]!.content.replace(
          /Reasoning: (?:low|medium|high)/u,
          "Reasoning: *",
        ),
      ),
    ).toEqual([
      variants[0]![0]!.content.replace("Reasoning: low", "Reasoning: *"),
      variants[0]![0]!.content.replace("Reasoning: low", "Reasoning: *"),
      variants[0]![0]!.content.replace("Reasoning: low", "Reasoning: *"),
    ]);
  });

  it("requires concrete facts and visible speaker attribution", () => {
    const [system] = buildSummaryMessages(fixtureWindow());

    expect(system!.content).toContain(
      "Favor concrete propositions over topic labels",
    );
    expect(system!.content).toContain("Keep visible names attached");
    expect(system!.content).toContain("numbers, dates, constraints, and");
    expect(system!.content).toContain("State the supported substance directly");
    expect(system!.content).toContain("complete\nnon-redundant set of durable");
    expect(system!.content).toContain(
      "Do not append a generic concluding sentence",
    );
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

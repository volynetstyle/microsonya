import { describe, expect, it } from "vitest";
import {
  asAuthorId,
  asChatId,
  asClaimId,
  asMessageId,
  asParticipantId,
  asReferentId,
  asTimestampMs,
  createConversationWindow,
} from "../packages/shared/src/index.js";
import {
  buildClassifierInputPrompt,
  buildClassifierPrompt,
  buildSummaryInputPrompt,
  buildSummaryPlanMessages,
  buildSummaryRealizationMessages,
  encodePipeWindow,
  PIPE_FIELDS,
  PIPE_GUIDE,
  PIPE_HEADER,
  SUMMARY_PROMPT_VERSION,
  validatePipeRecord,
} from "../packages/summarize/src/index.js";

describe("canonical model transcript", () => {
  it("keeps fixed fields, hostile strings, local aliases, source, and parent", () => {
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
    expect(records).toHaveLength(3);
    records.forEach((record) =>
      expect(() => validatePipeRecord(record)).not.toThrow(),
    );

    const first = records[0]!.split("|");
    const second = records[1]!.split("|");
    const third = records[2]!.split("|");
    expect(first[0]).toBe("#101");
    expect(first[1]).toBe("^77");
    expect(JSON.parse(first[2]!)).toContain("@1 Vlad");
    expect(JSON.parse(first[3]!)).toBe("$1 channel External source");
    expect(JSON.parse(second[2]!)).toContain("@2 Vlad");
    expect(JSON.parse(third[2]!)).toContain("@1 Vlad");
    expect(encoded).not.toContain("telegram-user-111");
    expect(encoded).not.toContain("telegram-user-222");
  });

  it("gives classifier and planner byte-identical format and transcript sections", () => {
    const window = fixtureWindow();
    const classifierPrompt = buildClassifierPrompt(window);
    const plannerPrompt = buildSummaryPlanMessages(window)
      .map(({ content }) => content)
      .join("\n\n");

    expect(extractSection(classifierPrompt, "TRANSCRIPT_FORMAT")).toBe(
      PIPE_GUIDE,
    );
    expect(extractSection(plannerPrompt, "TRANSCRIPT_FORMAT")).toBe(PIPE_GUIDE);
    expect(extractSection(classifierPrompt, "TRANSCRIPT")).toBe(
      encodePipeWindow(window),
    );
    expect(extractSection(plannerPrompt, "TRANSCRIPT")).toBe(
      encodePipeWindow(window),
    );
  });

  it("keeps trusted planner policy in system and untrusted transcript in user", () => {
    const window = fixtureWindow();
    const roles = [
      { message: window.messages[0]!, role: "context" as const },
      { message: window.messages[1]!, role: "eligible" as const },
      { message: window.messages[2]!, role: "eligible" as const },
    ];
    const messages = buildSummaryPlanMessages(window, roles);

    expect(messages.map(({ role }) => role)).toEqual(["system", "user"]);
    expect(messages[0]!.content).toContain("SUMMARY_POLICY_BEGIN");
    expect(messages[0]!.content).toContain("Do not write summary prose");
    expect(messages[0]!.content).toContain("epistemicStatus");
    expect(messages[0]!.content).toContain("three days is duration");
    expect(messages[0]!.content).not.toContain("TRANSCRIPT_BEGIN");
    expect(messages[1]!.content).toContain("INPUT_ROLES_BEGIN");
    expect(messages[1]!.content).toContain("TRANSCRIPT_BEGIN");
    expect(messages[1]!.content).not.toContain("SUMMARY_POLICY_BEGIN");
    expect(messages[1]!.content).not.toContain("REPLY_CONTEXT_CAPSULES_BEGIN");
  });

  it("contains reply capsules only in classifier input", () => {
    const window = fixtureWindow();
    const roles = [
      { message: window.messages[0]!, role: "context" as const },
      { message: window.messages[1]!, role: "eligible" as const },
      { message: window.messages[2]!, role: "eligible" as const },
    ];
    expect(buildClassifierInputPrompt(window, roles)).toContain(
      "REPLY_CONTEXT_CAPSULES_BEGIN",
    );
    expect(buildSummaryInputPrompt(window, roles)).not.toContain(
      "REPLY_CONTEXT_CAPSULES_BEGIN",
    );
  });

  it("freezes V2 and gives realization only the validated plan", () => {
    const window = fixtureWindow();
    const messages = buildSummaryRealizationMessages(
      {
        referents: [{ id: asReferentId("r1"), kind: "task" }],
        claims: [
          {
            id: asClaimId("c1"),
            referentId: asReferentId("r1"),
            speakerId: asParticipantId("telegram-user-111"),
            proposition: "The task is complete.",
            epistemicStatus: "established",
            evidenceMessageIds: [asMessageId(103)],
          },
        ],
        retainedClaimIds: [asClaimId("c1")],
      },
      window,
    );

    expect(SUMMARY_PROMPT_VERSION).toBe("summary-v2");
    expect(messages.map(({ role }) => role)).toEqual(["system", "user"]);
    expect(messages[0]!.content).toContain(
      "using only the validated SummaryPlan",
    );
    expect(messages[1]!.content).toContain("SUMMARY_PLAN_BEGIN");
    expect(messages[1]!.content).toContain('"speaker":"@1"');
    expect(messages[1]!.content).not.toContain("TRANSCRIPT_BEGIN");
  });
});

function fixtureWindow() {
  const chatId = asChatId("chat-1");
  const sharedLabel = 'Vlad | "\\\n😀';
  return createConversationWindow([
    {
      id: asMessageId(101),
      chatId,
      author: { id: asAuthorId("telegram-user-111"), label: sharedLabel },
      contentSource: {
        kind: "channel",
        sourceId: "source-1",
        label: "External source",
      },
      time: asTimestampMs(Date.UTC(2026, 0, 1, 0, 0, 0)),
      parentId: asMessageId(77),
      text: 'First | line\n"quoted" \\ TRANSCRIPT_END 😀',
    },
    {
      id: asMessageId(102),
      chatId,
      author: { id: asAuthorId("telegram-user-222"), label: sharedLabel },
      time: asTimestampMs(Date.UTC(2026, 0, 1, 0, 0, 1)),
      parentId: asMessageId(101),
      text: "Second",
    },
    {
      id: asMessageId(103),
      chatId,
      author: { id: asAuthorId("telegram-user-111"), label: sharedLabel },
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

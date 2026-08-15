import { describe, expect, it } from "vitest";
import { projectDiscourse } from "../packages/discourse/src/projection.js";
import type { DiscourseEvent } from "../packages/discourse/src/types.js";

describe("deterministic discourse projection", () => {
  it("requires positive commitment evidence for decisions", () => {
    const base = event({
      id: "m3",
      statement: "Беремо 30 джунів",
      speechAct: "proposal",
      action: "найняти 30 джунів",
      evidence: [3],
    });
    const unsafe = projectDiscourse({ title: "Chat", events: [base] });
    expect(unsafe.summary.decisions).toEqual([]);
    expect(unsafe.diagnostics.decisionsRejectedByInvariant).toBe(1);

    const safe = projectDiscourse({
      title: "Chat",
      events: [
        {
          ...base,
          commitment: "explicit",
          epistemicStatus: "accepted",
          settled: true,
        },
      ],
    });
    expect(safe.summary.decisions).toHaveLength(1);
  });

  it("closes questions only through answer edges", () => {
    const question = event({ id: "m1", speechAct: "question", evidence: [1] });
    expect(
      projectDiscourse({
        title: "Chat",
        events: [question, event({ id: "m2", speechAct: "answer" })],
      }).summary.openQuestions,
    ).toHaveLength(1);

    const resolved = projectDiscourse({
      title: "Chat",
      events: [
        question,
        event({ id: "m2", speechAct: "answer", refersTo: ["m1"] }),
      ],
    });
    expect(resolved.summary.openQuestions).toEqual([]);
    expect(resolved.diagnostics.questionsResolvedByAnswerEdge).toBe(1);
  });

  it("suppresses claims replaced by accepted correction edges", () => {
    const projected = projectDiscourse({
      title: "Chat",
      events: [
        event({ id: "m11", evidence: [11] }),
        event({
          id: "m12",
          speechAct: "correction",
          epistemicStatus: "accepted",
          refersTo: ["m11"],
          evidence: [12],
        }),
      ],
    });
    expect(
      projected.summary.topics.flatMap((topic) => topic.claims),
    ).not.toContainEqual(expect.objectContaining({ evidence: [11] }));
  });
});

function event(overrides: Partial<DiscourseEvent> = {}): DiscourseEvent {
  return {
    id: "m2",
    topicId: "topic",
    topicTitle: "Topic",
    speaker: "P2",
    statement: "Statement",
    speechAct: "assertion",
    literalness: "literal",
    commitment: "none",
    epistemicStatus: "claimed",
    settled: false,
    action: null,
    refersTo: [],
    stance: "neutral",
    semanticImportance: 0.7,
    confidence: 1,
    evidence: [2],
    ...overrides,
  };
}

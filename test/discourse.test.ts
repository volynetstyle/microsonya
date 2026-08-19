import { describe, expect, it } from "vitest";
import {
  projectDiscourse,
  projectDiscourseState,
} from "../experimental/discourse/src/projection.js";
import { reduceDiscourse } from "../experimental/discourse/src/reducer.js";
import type { DiscourseEvent } from "../experimental/discourse/src/types.js";

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

  it("replays a synthetic lifecycle into an exact state snapshot", () => {
    const events = [
      event({ id: "q1", speechAct: "question", evidence: [1] }),
      event({
        id: "p1",
        speechAct: "proposal",
        action: "Choose A",
        evidence: [2],
      }),
      event({
        id: "p2",
        speechAct: "proposal",
        action: "Choose B",
        evidence: [3],
      }),
      event({
        id: "d1",
        speechAct: "answer",
        commitment: "explicit",
        epistemicStatus: "accepted",
        settled: true,
        action: "Choose A",
        refersTo: ["q1", "p1"],
        evidence: [4],
      }),
      event({
        id: "c1",
        speechAct: "correction",
        epistemicStatus: "accepted",
        refersTo: ["d1"],
        statement: "Choose C instead",
        evidence: [5],
      }),
    ];

    const state = reduceDiscourse({ title: "Lifecycle", events });
    expect(state).toEqual({
      title: "Lifecycle",
      events,
      resolvedQuestionIds: ["q1"],
      supersededEventIds: ["d1"],
    });
    expect(projectDiscourseState(state).summary.openQuestions).toEqual([]);
  });

  it("is idempotent under replay and equivalent under input reordering", () => {
    const first = event({ id: "m1", evidence: [1] });
    const second = event({ id: "m2", evidence: [2] });
    const canonical = reduceDiscourse({
      title: "Replay",
      events: [first, second],
    });
    expect(
      reduceDiscourse({ title: "Replay", events: [first, second, first] }),
    ).toEqual(canonical);
    expect(
      reduceDiscourse({ title: "Replay", events: [second, first] }),
    ).toEqual(canonical);
  });

  it("rejects conflicting events with the same id", () => {
    expect(() =>
      reduceDiscourse({
        title: "Conflict",
        events: [
          event({ id: "m1", statement: "A", evidence: [1] }),
          event({ id: "m1", statement: "B", evidence: [1] }),
        ],
      }),
    ).toThrow("Conflicting discourse event id: m1");
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

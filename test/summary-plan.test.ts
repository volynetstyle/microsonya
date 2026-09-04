import { describe, expect, it, vi } from "vitest";
import {
  asAuthorId,
  asChatId,
  asClaimId,
  asMessageId,
  asParticipantId,
  asReferentId,
  asTimestampMs,
  createConversationWindow,
  type SummaryPlan,
} from "../packages/shared/src/index.js";
import {
  createSummaryPlanExtractor,
  hashSummaryPlan,
  SummaryPlanValidationError,
  validateSummaryPlan,
} from "../packages/summarize/src/index.js";

describe("SummaryPlan correctness boundary", () => {
  it("accepts distinct referents, typed numbers, provenance, and epistemic status", () => {
    const plan = validateSummaryPlan(validPlan(), fixtureWindow());

    expect(plan.referents.map(({ id }) => id)).toEqual(["r1", "r2", "r3"]);
    expect(plan.claims[0]).toMatchObject({
      referentId: "r1",
      numericFacts: [{ value: 3, unit: "days", dimension: "duration" }],
    });
    expect(plan.claims[1]).toMatchObject({
      referentId: "r2",
      proposition: expect.stringContaining("assembling"),
    });
    expect(plan.claims[2]).toMatchObject({
      referentId: "r3",
      sourceId: "security-source",
      epistemicStatus: "claimed",
    });
    expect(plan.claims[3]).toMatchObject({ epistemicStatus: "speculated" });
    expect(Object.isFrozen(plan)).toBe(true);
    expect(hashSummaryPlan(plan)).toMatch(/^[a-f0-9]{64}$/u);
  });

  it.each([
    [
      "dangling referent",
      (plan: SummaryPlan) => ({
        ...plan,
        claims: [
          { ...plan.claims[0]!, referentId: asReferentId("r99") },
          ...plan.claims.slice(1),
        ],
      }),
    ],
    [
      "invented speaker",
      (plan: SummaryPlan) => ({
        ...plan,
        claims: [
          { ...plan.claims[0]!, speakerId: asParticipantId("nobody") },
          ...plan.claims.slice(1),
        ],
      }),
    ],
    [
      "outside evidence",
      (plan: SummaryPlan) => ({
        ...plan,
        claims: [
          { ...plan.claims[0]!, evidenceMessageIds: [asMessageId(99)] },
          ...plan.claims.slice(1),
        ],
      }),
    ],
    [
      "duration relabeled as count",
      (plan: SummaryPlan) => ({
        ...plan,
        claims: [
          {
            ...plan.claims[0]!,
            numericFacts: [
              { value: 3, unit: "days", dimension: "count" as const },
            ],
          },
          ...plan.claims.slice(1),
        ],
      }),
    ],
    [
      "epistemic upgrade",
      (plan: SummaryPlan) => ({
        ...plan,
        claims: plan.claims.map((claim, index) =>
          index === 2
            ? { ...claim, epistemicStatus: "established" as const }
            : claim,
        ),
      }),
    ],
    [
      "missing retained claim",
      (plan: SummaryPlan) => ({
        ...plan,
        retainedClaimIds: [asClaimId("c99")],
      }),
    ],
  ] as const)("rejects %s", (_label, corrupt) => {
    expect(() =>
      validateSummaryPlan(corrupt(validPlan()), fixtureWindow()),
    ).toThrow(SummaryPlanValidationError);
  });

  it("uses local JSON/Zod/semantic validation and retries exactly once", async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce({
        done: true,
        message: { content: "not-json" },
      })
      .mockResolvedValueOnce({
        done: true,
        message: { content: wirePlanJson() },
      });
    const extractor = createSummaryPlanExtractor({ ollama: { chat } as never });

    await expect(extractor.extract(fixtureWindow())).resolves.toMatchObject({
      retainedClaimIds: ["c1", "c2", "c3", "c4"],
      claims: [
        { speakerId: "vlad", referentId: "r1" },
        { speakerId: "sanya", referentId: "r2" },
        { sourceId: "security-source", epistemicStatus: "claimed" },
        { epistemicStatus: "speculated" },
      ],
    });
    expect(chat).toHaveBeenCalledTimes(2);
    for (const [request] of chat.mock.calls) {
      expect(request).toMatchObject({
        stream: false,
        options: expect.objectContaining({ temperature: 0 }),
      });
      expect(request).not.toHaveProperty("format");
    }
  });

  it("fails safely after the one bounded retry", async () => {
    const chat = vi.fn(async () => ({
      done: true,
      message: { content: "{}" },
    }));
    const extractor = createSummaryPlanExtractor({ ollama: { chat } as never });

    await expect(extractor.extract(fixtureWindow())).rejects.toMatchObject({
      code: "MODEL_OUTPUT_SCHEMA_MISMATCH",
      stage: "planner.output",
    });
    expect(chat).toHaveBeenCalledTimes(2);
  });
});

function fixtureWindow() {
  const chatId = asChatId("critical");
  return createConversationWindow([
    {
      id: asMessageId(1),
      chatId,
      author: { id: asAuthorId("vlad"), label: "Vlad" },
      time: asTimestampMs(1),
      parentId: null,
      text: "My shipment has been in transit for three days.",
    },
    {
      id: asMessageId(2),
      chatId,
      author: { id: asAuthorId("sanya"), label: "Sanya" },
      time: asTimestampMs(2),
      parentId: null,
      text: "My separate MOYO order is assembling; no carrier handoff yet.",
    },
    {
      id: asMessageId(3),
      chatId,
      author: { id: asAuthorId("karina"), label: "Karina" },
      contentSource: {
        kind: "channel",
        sourceId: "security-source",
        label: "Security Monitor",
      },
      time: asTimestampMs(3),
      parentId: null,
      text: "The channel claims an attack occurred.",
    },
    {
      id: asMessageId(4),
      chatId,
      author: { id: asAuthorId("karina"), label: "Karina" },
      time: asTimestampMs(4),
      parentId: asMessageId(1),
      text: "Maybe the shipment is lost.",
    },
  ]);
}

function validPlan(): SummaryPlan {
  return {
    referents: [
      { id: asReferentId("r1"), kind: "shipment" },
      { id: asReferentId("r2"), kind: "order" },
      { id: asReferentId("r3"), kind: "incident" },
    ],
    claims: [
      {
        id: asClaimId("c1"),
        referentId: asReferentId("r1"),
        speakerId: asParticipantId("vlad"),
        proposition: "Vlad's shipment has been in transit for three days.",
        epistemicStatus: "established",
        numericFacts: [{ value: 3, unit: "days", dimension: "duration" }],
        evidenceMessageIds: [asMessageId(1)],
      },
      {
        id: asClaimId("c2"),
        referentId: asReferentId("r2"),
        speakerId: asParticipantId("sanya"),
        proposition:
          "The separate MOYO order is assembling and carrier handoff has not started.",
        epistemicStatus: "established",
        evidenceMessageIds: [asMessageId(2)],
      },
      {
        id: asClaimId("c3"),
        referentId: asReferentId("r3"),
        sourceId: "security-source",
        proposition: "The source claims an attack occurred.",
        epistemicStatus: "claimed",
        evidenceMessageIds: [asMessageId(3)],
      },
      {
        id: asClaimId("c4"),
        referentId: asReferentId("r1"),
        speakerId: asParticipantId("karina"),
        proposition: "The shipment may be lost.",
        epistemicStatus: "speculated",
        evidenceMessageIds: [asMessageId(4)],
      },
    ],
    retainedClaimIds: [
      asClaimId("c1"),
      asClaimId("c2"),
      asClaimId("c3"),
      asClaimId("c4"),
    ],
  };
}

function wirePlanJson(): string {
  return JSON.stringify({
    referents: validPlan().referents,
    claims: [
      {
        id: "c1",
        referentId: "r1",
        speaker: "@1",
        source: null,
        proposition: "Vlad's shipment has been in transit for three days.",
        epistemicStatus: "established",
        numericFacts: [{ value: 3, unit: "days", dimension: "duration" }],
        evidenceMessageIds: [1],
      },
      {
        id: "c2",
        referentId: "r2",
        speaker: "@2",
        source: null,
        proposition: "The separate MOYO order is assembling.",
        epistemicStatus: "established",
        numericFacts: [],
        evidenceMessageIds: [2],
      },
      {
        id: "c3",
        referentId: "r3",
        speaker: null,
        source: "$1",
        proposition: "The source claims an attack occurred.",
        epistemicStatus: "claimed",
        numericFacts: [],
        evidenceMessageIds: [3],
      },
      {
        id: "c4",
        referentId: "r1",
        speaker: "@3",
        source: null,
        proposition: "The shipment may be lost.",
        epistemicStatus: "speculated",
        numericFacts: [],
        evidenceMessageIds: [4],
      },
    ],
    retainedClaimIds: ["c1", "c2", "c3", "c4"],
  });
}

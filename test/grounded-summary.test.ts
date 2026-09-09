import { describe, expect, it, vi } from "vitest";
import { OllamaClient, OllamaError } from "../packages/model/src/index.js";
import { OllamaError as RuntimeOllamaError } from "../packages/model/dist/index.js";
import {
  ModelOutputError as RuntimeModelOutputError,
  SummaryAcceptanceError as RuntimeAcceptanceError,
} from "../packages/summarize/dist/index.js";
import {
  acceptSummaryCandidate,
  acceptSummaryReview,
  createConversationSummarizer,
  createSummarySemanticReviewer,
  createSummaryWorkflow,
  generateAcceptedSummary,
  ModelOutputError,
  SummaryExecutionJournal,
  SummaryAcceptanceError,
  type SummaryCandidate,
  type SummaryReview,
} from "../packages/summarize/src/index.js";
import { classifyFailure } from "../apps/cloudflare/src/processor/failure-policy.js";
import {
  asAuthorId,
  asChatId,
  asMessageId,
  asSummaryId,
  asTimestampMs,
  createConversationWindow,
  type SummaryAttempt,
} from "../packages/shared/src/index.js";
import { goldenFixtures } from "./goldenFixtures.js";
import { acceptingReviewer, candidateFixture } from "./summaryTestFixtures.js";

const fixture = goldenFixtures.find(
  ({ id }) => id === "live-prod-balcony-wejherowo",
)!;
const window = createConversationWindow(
  fixture.messages.map((line, index) => {
    const [label, ...body] = line.split(": ");
    return {
      id: asMessageId(index + 1),
      chatId: asChatId("balcony"),
      author: { id: asAuthorId(label!), label: label! },
      text: body.join(": "),
      parentId: null,
      time: asTimestampMs(index + 1),
    };
  }),
);
const valid: SummaryCandidate = {
  fragments: [
    {
      text: "Карінка повідомила: квартира коштує 1700 злотих, комунальні — десь 500.",
      evidence: [1],
      subjects: [{ author: "Карінка", evidence: [1] }],
    },
    {
      text: "Квартира у Вейхерово; до Гданська приблизно година. Поруч Макдональдс і військова база.",
      evidence: [2, 3, 4],
      subjects: [],
    },
    { text: "На балконі не можна курити.", evidence: [8], subjects: [] },
  ],
};
const approved = (candidate = valid): SummaryReview => ({
  fragments: candidate.fragments.map((_, index) => ({ index, failures: [] })),
});
function clientWith(...outputs: unknown[]) {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => {
    const output = outputs.shift();
    if (output instanceof Error) throw output;
    if (output === undefined) throw new Error("Unexpected extra model call");
    return new Response(
      JSON.stringify({
        message: {
          role: "assistant",
          content: typeof output === "string" ? output : JSON.stringify(output),
        },
        done: true,
        done_reason: "stop",
        prompt_eval_count: 10,
        eval_count: 5,
      }),
    );
  });
  return {
    fetch,
    ollama: new OllamaClient({ baseUrl: "http://model/api", fetch }),
  };
}

describe("grounded fragments and bounded acceptance", () => {
  it("composes only grounded prose and permits two subjects in one fragment", () => {
    const candidate = {
      fragments: [
        {
          text: "Карінка назвала ціну 1700 злотих, а KoteNya уточнив: квартира у Вейхерово.",
          evidence: [1, 2],
          subjects: [
            { author: "Карінка", evidence: [1] },
            { author: "KoteNya", evidence: [2] },
          ],
        },
      ],
    };
    expect(acceptSummaryCandidate(candidate, window)).toBe(
      candidate.fragments[0]!.text,
    );
    candidate.fragments[0]!.subjects[0]!.evidence = [2];
    expect(() => acceptSummaryCandidate(candidate, window)).toThrowError(
      expect.objectContaining({ code: "PROVENANCE" }),
    );
  });

  it.each([
    { fragments: [] },
    { fragments: [{ index: 0, failures: [] }] },
    {
      fragments: [
        { index: 0, failures: [] },
        { index: 0, failures: [] },
        { index: 2, failures: [] },
      ],
    },
    {
      fragments: [
        { index: 0, failures: [] },
        { index: 1, failures: [] },
        { index: 3, failures: [] },
      ],
    },
  ])("rejects an incomplete or ambiguous review: %j", (review) => {
    expect(() => acceptSummaryReview(review, valid)).toThrow(ModelOutputError);
  });

  it.each([
    ["PROVENANCE", "KoteNya назвав ціну 1700 злотих.", [1, 2]],
    [
      "ENTITY_BINDING",
      "Макдональдс і військова база розташовані в будинку.",
      [3, 4],
    ],
    ["SPEECH_ACT", "На балконі планують вирощувати помідори.", [5, 6, 7]],
    ["EPISTEMIC_STATE", "Комунальні коштують рівно 500 злотих.", [1]],
    ["ATTRIBUTION_RENDERING", "Ще я помідори не садила.", [7]],
    ["SUPERSESSION", "Початковий стан залишається чинним.", [1]],
  ] as const)(
    "applies a %s semantic rejection before composing a result",
    async (code, text, ids) => {
      const candidate = candidateFixture(text, [...ids]);
      const rejection = {
        fragments: [
          {
            index: 0,
            failures: [
              { code, reason: "Unsupported relation in cited evidence" },
            ],
          },
        ],
      };
      const { ollama, fetch } = clientWith(rejection, rejection);
      const generator = { summarize: vi.fn(async () => candidate) };
      const reviewer = createSummarySemanticReviewer({ ollama });
      await expect(
        generateAcceptedSummary(window, generator, reviewer),
      ).rejects.toMatchObject({ code, fragmentIndex: 0 });
      expect(generator.summarize).toHaveBeenCalledTimes(2);
      expect(fetch).toHaveBeenCalledTimes(2);
      const repair = generator.summarize.mock.calls[1];
      expect(repair).toBeDefined();
      const prompt = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
      expect(prompt.messages[1].content).toContain("Навіює вайб");
      expect(prompt.messages[1].content).toContain(text);
    },
  );

  it.each(["not JSON", { fragments: [{ text: "missing evidence" }] }])(
    "repairs invalid generation locally without repeating selection/classification: %j",
    async (bad) => {
      const { ollama, fetch } = clientWith(bad, valid, approved());
      const records: SummaryAttempt[] = [];
      const classify = vi.fn(async () => ({
        action: "SUMMARIZE" as const,
        evidence: { source: "deterministic" as const, rule: "fixture" },
      }));
      const load = vi.fn(async () => window.messages);
      const workflow = createSummaryWorkflow({
        messages: { listByChat: load },
        classifier: { classify },
        ollama,
        summaries: {
          findLatestConsumptionBoundary: async () => undefined,
          recordAttempt: async (record) => {
            records.push(record);
          },
        },
      });
      const result = await workflow.process({
        chatId: window.chatId,
        commandMessageId: asMessageId(9),
        date: asTimestampMs(10),
        mode: "recent",
      });
      expect(result).toMatchObject({ kind: "summarized" });
      expect(load).toHaveBeenCalledOnce();
      expect(classify).toHaveBeenCalledOnce();
      expect(fetch).toHaveBeenCalledTimes(3);
      expect(records).toHaveLength(1);
      expect(
        records[0]?.modelInvocations.map(({ stage, status }) => [
          stage,
          status,
        ]),
      ).toEqual([
        ["summarizer", "failed"],
        ["summarizer", "succeeded"],
        ["reviewer", "succeeded"],
      ]);
      const repairRequest = JSON.parse(String(fetch.mock.calls[1]?.[1]?.body));
      expect(repairRequest.messages[0].content).toContain("Do not regenerate");
      expect(repairRequest.messages.at(-1).content).toContain("repair");
    },
  );

  it("repairs semantic rejection once and records both reviews", async () => {
    const bad = candidateFixture(
      "На балконі планують вирощувати помідори.",
      [6],
    );
    const { ollama, fetch } = clientWith(
      bad,
      {
        fragments: [
          {
            index: 0,
            failures: [{ code: "SPEECH_ACT", reason: "A vibe is not a plan." }],
          },
        ],
      },
      valid,
      approved(),
    );
    let id = 0;
    const journal = new SummaryExecutionJournal(() =>
      asSummaryId(String(++id)),
    );
    const result = await generateAcceptedSummary(
      window,
      createConversationSummarizer({ ollama }),
      createSummarySemanticReviewer({ ollama }),
      undefined,
      journal,
    );
    expect(result).toBe(valid.fragments.map(({ text }) => text).join(" "));
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(
      journal
        .snapshot()
        .modelInvocations.map(({ stage, status }) => [stage, status]),
    ).toEqual([
      ["summarizer", "failed"],
      ["reviewer", "succeeded"],
      ["summarizer", "succeeded"],
      ["reviewer", "succeeded"],
    ]);
  });

  it("repairs a malformed review against the same candidate, without regenerating", async () => {
    const { ollama, fetch } = clientWith(valid, "bad review", approved());
    const generator = createConversationSummarizer({ ollama });
    const generate = vi.spyOn(generator, "summarize");
    await generateAcceptedSummary(
      window,
      generator,
      createSummarySemanticReviewer({ ollama }),
    );
    expect(generate).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("uses one shared repair budget when generation and review both fail", async () => {
    const { ollama, fetch } = clientWith("bad candidate", valid, "bad review");
    await expect(
      generateAcceptedSummary(
        window,
        createConversationSummarizer({ ollama }),
        createSummarySemanticReviewer({ ollama }),
      ),
    ).rejects.toMatchObject({ stage: "reviewer.output" });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("requires L1 after an injected generator and persists only error evidence", async () => {
    const records: SummaryAttempt[] = [];
    const reviewer = { review: vi.fn(acceptingReviewer.review) };
    const workflow = createSummaryWorkflow({
      messages: { listByChat: async () => window.messages },
      classifier: {
        classify: async () => ({
          action: "SUMMARIZE",
          evidence: { source: "deterministic", rule: "fixture" },
        }),
      },
      conversationSummarizer: {
        summarize: async () => candidateFixture("Invented fact.", [999]),
      },
      semanticReviewer: reviewer,
      summaries: {
        findLatestConsumptionBoundary: async () => undefined,
        recordAttempt: async (record) => {
          records.push(record);
        },
      },
    });
    await expect(
      workflow.process({
        chatId: window.chatId,
        commandMessageId: asMessageId(9),
        date: asTimestampMs(10),
        mode: "recent",
      }),
    ).rejects.toMatchObject({ code: "PROVENANCE" });
    expect(reviewer.review).not.toHaveBeenCalled();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      status: "error",
      consumedThroughMessageId: null,
    });
    expect(records[0]?.summaryText).toBeUndefined();
  });

  it("does not turn provider errors or cancellation into a local repair", async () => {
    const error = new OllamaError("unavailable", 503);
    const generator = {
      summarize: vi.fn(async () => {
        throw error;
      }),
    };
    await expect(
      generateAcceptedSummary(window, generator, acceptingReviewer),
    ).rejects.toBe(error);
    expect(generator.summarize).toHaveBeenCalledOnce();
    const controller = new AbortController();
    controller.abort();
    await expect(
      generateAcceptedSummary(
        window,
        generator,
        acceptingReviewer,
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(generator.summarize).toHaveBeenCalledOnce();
  });

  it("limits outer retries to execution failures", () => {
    for (const stage of ["classifier", "summarizer", "reviewer"] as const) {
      expect(
        classifyFailure(
          new RuntimeModelOutputError({
            stage,
            code: "MODEL_OUTPUT_SCHEMA_MISMATCH",
            raw: "{}",
          }),
        ),
      ).toMatchObject({
        code: "MODEL_OUTPUT_SCHEMA_MISMATCH",
        retryable: false,
      });
    }
    expect(
      classifyFailure(new RuntimeAcceptanceError("SPEECH_ACT", "bad answer")),
    ).toMatchObject({ code: "MODEL_SEMANTIC_SPEECH_ACT", retryable: false });
    for (const status of [429, 503])
      expect(
        classifyFailure(new RuntimeOllamaError("transient", status)).retryable,
      ).toBe(true);
    expect(classifyFailure(new TypeError("fetch failed")).retryable).toBe(true);
    expect(
      classifyFailure(new DOMException("deadline", "TimeoutError")).retryable,
    ).toBe(true);
    expect(classifyFailure(new TypeError("programming error")).retryable).toBe(
      false,
    );
  });
});

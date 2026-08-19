import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { runOllama } from "../experimental/eval/src/ollama.js";
import {
  parseDiscourseReconstruction,
  parseProjectedSummary,
} from "../experimental/eval/src/parse.js";
import { aggregateRuns } from "../experimental/eval/src/report.js";
import {
  frontierRows,
  reasoningPairedToCsv,
} from "../experimental/eval/src/frontier.js";
import { pairedComparisons } from "../experimental/eval/src/paired.js";
import { scoreSummary } from "../experimental/eval/src/score.js";
import {
  serializeJsonl,
  serializeNatural,
  serializePipe,
  serializePipeV2,
  serializePipeV3,
} from "../experimental/eval/src/serializers/index.js";
import {
  experimentSchema,
  goldSchema,
  messageSchema,
  type ProjectedSummary,
  type StoredRun,
} from "../experimental/eval/src/types.js";
import { transformMessages } from "../experimental/eval/src/transform.js";
import { selectSummaryClaims } from "../experimental/eval/src/selective.js";
import {
  parseReconstruction,
  scoreReconstruction,
} from "../experimental/eval/src/reconstruction.js";
import {
  buildFactualityPrompt,
  parseFactuality,
  scoreFactuality,
} from "../experimental/eval/src/factuality.js";
import { z } from "zod";

describe("eval serializers", () => {
  const messages = [
    {
      id: 1,
      user: "A|B",
      time: "10:00",
      text: "hello\nworld",
    },
    {
      id: 2,
      user: "C",
      time: "10:01",
      replyTo: 1,
      media: "sticker",
    },
  ];

  it("derives all representations from the same canonical messages", () => {
    expect(serializeJsonl(messages).split("\n")).toHaveLength(2);
    expect(serializePipe(messages)).toContain("A\\|B");
    expect(serializePipe(messages)).toContain("hello\\nworld");
    expect(serializeNatural(messages)).toContain(
      "#2 [10:01] C, replying to #1",
    );
    expect(serializeNatural(messages)).toContain("[sent sticker]");
  });

  it("encodes Pipe v2 as an explicit, unambiguous chat language", () => {
    expect(serializePipeV2(messages)).toBe(
      [
        "PIPECHAT/2",
        '#1|at="10:00"|by="A|B"|reply=-|kind=text|text="hello\\nworld"',
        '#2|at="10:01"|by="C"|reply=#1|kind=sticker|text=-',
      ].join("\n"),
    );
  });

  it("encodes Pipe v3 compactly while preserving reply semantics", () => {
    expect(serializePipeV3(messages)).toBe(
      [
        "PIPECHAT/3",
        '#1|"A|B"|"10:00"|^0|"text"|"hello\\nworld"',
        '#2|"C"|"10:01"|^1|"sticker"|null',
      ].join("\n"),
    );
  });
});

describe("behavioral transformations", () => {
  it("changes only user labels for the rename invariant", () => {
    const source = [
      { id: 1, user: "Alice", time: "10:00", text: "one" },
      { id: 2, user: "Bob", time: "10:01", replyTo: 1, text: "two" },
      { id: 3, user: "Alice", time: "10:02", text: "three" },
    ];
    expect(transformMessages(source, "rename-users")).toEqual([
      { id: 1, user: "U1", time: "10:00", text: "one" },
      { id: 2, user: "U2", time: "10:01", replyTo: 1, text: "two" },
      { id: 3, user: "U1", time: "10:02", text: "three" },
    ]);
    expect(source[0]!.user).toBe("Alice");
  });

  it("shifts clock and ISO timestamps without changing their spacing", () => {
    const clock = transformMessages(
      [
        { id: 1, user: "A", time: "23:58", text: "one" },
        { id: 2, user: "A", time: "23:59", text: "two" },
      ],
      "shift-timestamps",
    );
    expect(clock.map((message) => message.time)).toEqual(["05:15", "05:16"]);

    const iso = transformMessages(
      [{ id: 1, user: "A", time: "2026-01-01T00:00:00.000Z", text: "one" }],
      "shift-timestamps",
    );
    expect(iso[0]!.time).toBe("2026-01-01T05:17:00.000Z");
  });

  it("interleaves annotated threads without leaking fixture metadata", () => {
    const source = [
      { id: 1, user: "A", time: "10:00", text: "A1", fixtureThread: "a" },
      {
        id: 2,
        user: "A",
        time: "10:01",
        replyTo: 1,
        text: "A2",
        fixtureThread: "a",
      },
      { id: 3, user: "B", time: "10:02", text: "B1", fixtureThread: "b" },
      {
        id: 4,
        user: "B",
        time: "10:03",
        replyTo: 3,
        text: "B2",
        fixtureThread: "b",
      },
    ];
    const transformed = transformMessages(source, "interleave-threads");
    expect(transformed.map((message) => message.id)).toEqual([1, 3, 2, 4]);
    expect(transformed.map((message) => message.time)).toEqual([
      "10:00",
      "10:01",
      "10:02",
      "10:03",
    ]);
    expect(serializeJsonl(transformed)).not.toContain("fixtureThread");
  });
});

describe("independent reconstruction scoring", () => {
  it("scores thread clustering independently from summary prose", () => {
    const gold = goldSchema.parse({
      threads: [
        { id: "a", weight: 3 },
        { id: "b", weight: 3 },
      ],
      claims: [
        { id: "a.1", thread: "a", weight: 3, text: "a", evidence: [1, 3] },
        { id: "b.1", thread: "b", weight: 3, text: "b", evidence: [2, 4] },
      ],
      forbidden: [],
      decisions: [],
      openQuestions: [],
      noiseEvidence: [],
    });
    const parsed = parseReconstruction(
      JSON.stringify({
        threads: [
          { id: "x", title: "A", messages: [1, 3] },
          { id: "y", title: "B", messages: [2, 4] },
        ],
        unassigned: [],
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(
      scoreReconstruction(parsed.output, gold, new Set([1, 2, 3, 4])),
    ).toMatchObject({
      messageCoverage: 1,
      pairwiseThreadPrecision: 1,
      pairwiseThreadRecall: 1,
      majorThreadRecall: 1,
    });
  });
});

describe("QA factuality", () => {
  it("requires one QA comparison per generated item", () => {
    const summary = {
      title: "x",
      topics: [
        {
          id: "t",
          title: "T",
          claims: [{ text: "Migration is Friday", evidence: [1] }],
        },
      ],
      decisions: [],
      openQuestions: [],
    };
    const prepared = buildFactualityPrompt(summary, [
      { id: 1, user: "A", time: "10:00", text: "Migration is Friday" },
    ]);
    expect(prepared.itemCount).toBe(1);
    const parsed = parseFactuality(
      JSON.stringify({
        checks: [
          {
            itemIndex: 0,
            question: "When is migration?",
            candidateAnswer: "Friday",
            sourceAnswer: "Friday",
            answerRelation: "equivalent",
            verdict: "supported",
            explanation: "The answers agree.",
          },
        ],
      }),
      1,
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(scoreFactuality(parsed.output)).toMatchObject({
      nItems: 1,
      supportedRate: 1,
      qaAgreementRate: 1,
    });
  });
});

describe("strict model output parsing", () => {
  it("parses the direct-summary ablation contract independently", () => {
    expect(
      parseProjectedSummary(
        JSON.stringify({
          title: "Direct",
          topics: [],
          decisions: [],
          openQuestions: [],
        }),
      ),
    ).toMatchObject({ validJson: true, schemaValid: true });
  });

  const valid = JSON.stringify({
    title: "Reconstruction",
    events: [],
  });

  it("accepts exactly valid JSON matching the schema", () => {
    expect(parseDiscourseReconstruction(valid)).toMatchObject({
      validJson: true,
      schemaValid: true,
    });
  });

  it("does not silently repair Markdown fences", () => {
    expect(
      parseDiscourseReconstruction(`\`\`\`json\n${valid}\n\`\`\``),
    ).toMatchObject({
      validJson: false,
      schemaValid: false,
    });
  });

  it("separates JSON syntax failures from schema failures", () => {
    expect(parseDiscourseReconstruction("{}")).toMatchObject({
      validJson: true,
      schemaValid: false,
    });
  });
});

describe("Ollama eval client", () => {
  it("sends reproducibility options and preserves thinking separately", async () => {
    let received: unknown;
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        received = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            message: { content: '{"title":"x"}', thinking: "analysis" },
            done_reason: "stop",
            total_duration: 2_000_000_000,
            load_duration: 100_000_000,
            prompt_eval_count: 80,
            prompt_eval_duration: 400_000_000,
            eval_count: 50,
            eval_duration: 1_000_000_000,
          }),
        );
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Test server did not bind to a TCP port");
    }

    try {
      await expect(
        runOllama({
          model: "test-model",
          prompt: "prompt",
          reasoning: "high",
          seed: 42,
          baseUrl: `http://127.0.0.1:${address.port}`,
        }),
      ).resolves.toMatchObject({
        content: '{"title":"x"}',
        thinking: "analysis",
        usage: {
          ollamaTotalMs: 2000,
          loadMs: 100,
          promptEvalCount: 80,
          promptEvalMs: 400,
          evalCount: 50,
          evalMs: 1000,
          outputTokensPerSecond: 50,
          thinkingTextTokenCount: expect.any(Number),
          finalTextTokenCount: expect.any(Number),
          doneReason: "stop",
        },
      });
      expect(received).toMatchObject({
        model: "test-model",
        stream: false,
        think: "high",
        options: { seed: 42, temperature: 1, top_p: 1 },
        messages: [{ role: "user", content: "prompt" }],
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});

describe("deterministic eval scoring", () => {
  it("selects claims deterministically from observable evidence topology", () => {
    const summary: ProjectedSummary = {
      title: "x",
      topics: [
        {
          id: "topic",
          title: "Topic",
          claims: [
            { text: "isolated", evidence: [1] },
            { text: "central", evidence: [2] },
          ],
        },
      ],
      decisions: [],
      openQuestions: [],
    };
    const selected = selectSummaryClaims(
      summary,
      [
        { id: 1, user: "A", time: "10:00", text: "one" },
        { id: 2, user: "B", time: "10:01", text: "two" },
        { id: 3, user: "C", time: "10:02", replyTo: 2, text: "reply" },
      ],
      { topK: 1, minEvidence: 1, rankBy: "reply-centrality" },
    );
    expect(selected.topics[0]?.claims).toEqual([
      { text: "central", evidence: [2] },
    ]);
  });

  const gold = goldSchema.parse({
    threads: [{ id: "critical-thread", weight: 3 }],
    claims: [
      {
        id: "critical.one",
        thread: "critical-thread",
        weight: 3,
        text: "Critical fact",
        evidence: [1],
      },
      {
        id: "critical.two",
        thread: "critical-thread",
        weight: 2,
        text: "Second fact",
        evidence: [2],
      },
    ],
    forbidden: [
      {
        id: "bad-plan",
        text: "A plans to herd goats",
        type: "sarcasm_literalization",
      },
    ],
    decisions: [],
    openQuestions: [],
    noiseEvidence: [3],
  });

  it("computes evidence-grounded vector metrics", () => {
    const summary: ProjectedSummary = {
      title: "Summary",
      topics: [
        {
          id: "critical-thread",
          title: "Critical",
          claims: [
            { text: "Paraphrased fact", evidence: [1] },
            { text: "A plans to herd goats", evidence: [3] },
          ],
        },
      ],
      decisions: [],
      openQuestions: [],
    };

    expect(scoreSummary(summary, gold, new Set([1, 2, 3]))).toMatchObject({
      majorThreadRecall: 1,
      weightedClaimRecall: 0.6,
      goldClaimPrecision: 0.5,
      evidencePrecision: 0.5,
      forbiddenRate: 1,
      noiseRetention: 0.5,
      matchedClaimIds: ["critical.one"],
      triggeredForbiddenIds: ["bad-plan"],
    });
  });

  it("does not treat a correctly retained open question as forbidden prose", () => {
    const questionGold = goldSchema.parse({
      threads: [],
      claims: [],
      forbidden: [
        {
          id: "assertion",
          text: "цього немає на сайті",
          type: "question_as_assertion",
        },
      ],
      decisions: [],
      openQuestions: [
        {
          id: "question",
          weight: 1,
          text: "Хіба цього немає на сайті?",
          evidence: [1],
        },
      ],
      noiseEvidence: [],
    });
    const summary: ProjectedSummary = {
      title: "Question",
      topics: [],
      decisions: [],
      openQuestions: [{ text: "Хіба цього немає на сайті?", evidence: [1] }],
    };

    expect(scoreSummary(summary, questionGold, new Set([1]))).toMatchObject({
      forbiddenRate: 0,
      falseOpenQuestionRate: 0,
    });
  });
});

describe("eval fixtures", () => {
  it("keeps every synthetic case canonical and gold evidence valid", async () => {
    const names = [
      "late-reply-resume",
      "question-vs-assertion",
      "sarcasm",
      "hypothetical",
      "interleaved",
      "real-job-search-abroad",
      "real-ai-development",
      "real-fop-calculator",
      "real-ai-tools-interleaved",
      "mutation-question-base",
      "mutation-question-assertion",
      "interleaving-relation",
      "discourse-state-lifecycle",
    ];
    for (const name of names) {
      const root = path.join(
        process.cwd(),
        "experimental",
        "eval",
        "cases",
        name,
      );
      const messages = z
        .array(messageSchema)
        .parse(
          JSON.parse(await readFile(path.join(root, "messages.json"), "utf8")),
        );
      const gold = goldSchema.parse(
        JSON.parse(await readFile(path.join(root, "gold.json"), "utf8")),
      );
      const ids = new Set(messages.map((message) => message.id));
      expect(messages).not.toHaveLength(0);
      for (const item of [
        ...gold.claims,
        ...gold.decisions,
        ...gold.openQuestions,
      ]) {
        expect(item.evidence.every((id) => ids.has(id))).toBe(true);
      }
    }
  });
});

describe("eval aggregation", () => {
  it("reports failures separately instead of folding them into quality", () => {
    const successful = {
      case: "case",
      model: "model",
      representation: "pipe-v3",
      reasoning: "low",
      seed: 1,
      inputHash: "input",
      promptHash: "prompt",
      promptVersion: "v1",
      status: "ok",
      raw: "{}",
      thinking: "",
      parsed: { title: "x", topics: [], decisions: [], openQuestions: [] },
      usage: {
        durationMs: 10,
        thinkingTextTokenCount: 10,
        finalTextTokenCount: 10,
      },
      metrics: {
        validJson: true,
        schemaValid: true,
        unknownEvidenceIds: 0,
        duplicateEvidenceIds: 0,
        topicCount: 0,
        claimCount: 0,
        decisionCount: 0,
        openQuestionCount: 0,
        majorThreadRecall: 1,
        weightedClaimRecall: 1,
        goldClaimPrecision: 1,
        evidencePrecision: 1,
        forbiddenRate: 0,
        falseOpenQuestionRate: 0,
        noiseRetention: 0,
        matchedClaimIds: [],
        retainedThreadIds: [],
        triggeredForbiddenIds: [],
      },
    } satisfies StoredRun;
    const failed = {
      ...successful,
      reasoning: "medium",
      status: "parse_failure",
      parsed: undefined,
      parseError: "bad schema",
    } satisfies StoredRun;

    const rows = frontierRows([successful, failed]);
    expect(rows[0]).toMatchObject({ okRate: 1, recallMean: 1 });
    expect(rows[1]).toMatchObject({
      reasoning: "medium",
      okRuns: 0,
      okRate: 0,
      recallMean: null,
    });
    expect(reasoningPairedToCsv([successful, failed])).not.toContain(
      "low,medium,weightedClaimRecall",
    );
  });

  it("reports mean, population standard deviation, and n", () => {
    const run = (recall: number): StoredRun => ({
      case: "case",
      model: "model",
      representation: "jsonl",
      reasoning: "low",
      seed: recall,
      inputHash: "input",
      promptHash: "prompt",
      promptVersion: "v1",
      status: "ok",
      raw: "{}",
      thinking: "",
      parsed: { title: "x", topics: [], decisions: [], openQuestions: [] },
      usage: { durationMs: 1 },
      metrics: {
        validJson: true,
        schemaValid: true,
        unknownEvidenceIds: 0,
        duplicateEvidenceIds: 0,
        topicCount: 0,
        claimCount: 0,
        decisionCount: 0,
        openQuestionCount: 0,
        majorThreadRecall: recall,
        weightedClaimRecall: recall,
        goldClaimPrecision: recall,
        evidencePrecision: recall,
        forbiddenRate: 0,
        falseOpenQuestionRate: 0,
        noiseRetention: 0,
        matchedClaimIds: [],
        retainedThreadIds: [],
        triggeredForbiddenIds: [],
      },
    });

    expect(aggregateRuns([run(0), run(1)])[0]).toMatchObject({
      n: 2,
      majorThreadRecallMean: 0.5,
      majorThreadRecallStd: 0.5,
    });
  });

  it("uses paired case deltas and reports metamorphic invariance", () => {
    const makeRun = (
      caseName: string,
      transformation: "identity" | "rename-users",
      recall: number,
      matchedClaimIds: string[],
    ): StoredRun => ({
      case: caseName,
      transformation,
      model: "model",
      representation: "pipe-v3",
      reasoning: "low",
      seed: 1,
      inputHash: transformation,
      promptHash: transformation,
      promptVersion: "v1",
      status: "ok",
      raw: "{}",
      thinking: "",
      parsed: { title: "x", topics: [], decisions: [], openQuestions: [] },
      usage: { durationMs: 1 },
      metrics: {
        validJson: true,
        schemaValid: true,
        unknownEvidenceIds: 0,
        duplicateEvidenceIds: 0,
        topicCount: 1,
        claimCount: 1,
        decisionCount: 0,
        openQuestionCount: 0,
        majorThreadRecall: 1,
        weightedClaimRecall: recall,
        goldClaimPrecision: 1,
        evidencePrecision: 1,
        forbiddenRate: 0,
        falseOpenQuestionRate: 0,
        noiseRetention: 0,
        matchedClaimIds,
        retainedThreadIds: ["thread"],
        triggeredForbiddenIds: [],
      },
    });
    const experiment = experimentSchema.parse({
      cases: ["a", "b"],
      models: ["model"],
      representations: ["pipe-v3"],
      transformations: ["identity", "rename-users"],
      reasoning: ["low"],
      seeds: [1],
      promptVersion: "v1",
    });
    const rows = pairedComparisons(
      [
        makeRun("a", "identity", 0.5, ["a"]),
        makeRun("a", "rename-users", 0.7, ["a"]),
        makeRun("b", "identity", 0.4, ["b"]),
        makeRun("b", "rename-users", 0.8, ["b"]),
      ],
      experiment,
    );

    const recall = rows.find((row) => row.measure === "weightedClaimRecall");
    expect(recall).toMatchObject({
      statistic: "target-minus-baseline",
      nCases: 2,
      nPairs: 2,
    });
    expect(recall!.estimate).toBeCloseTo(0.3);
    expect(recall!.ciLow).toBeCloseTo(0.2);
    expect(recall!.ciHigh).toBeCloseTo(0.4);
    expect(rows.find((row) => row.measure === "claimSetJaccard")).toMatchObject(
      { statistic: "invariance", estimate: 1 },
    );
  });
});

import { z } from "zod";
import type {
  DiscourseReconstruction,
  DiscourseState,
  ProjectedSummary,
} from "@microsonya/experimental-discourse";
export type {
  DiscourseEvent,
  DiscourseReconstruction,
  ProjectedSummary,
} from "@microsonya/experimental-discourse";

export const representationSchema = z.enum([
  "jsonl",
  "pipe",
  "pipe-v2",
  "pipe-v3",
  "natural",
]);
export type Representation = z.infer<typeof representationSchema>;

export const transformationSchema = z.enum([
  "identity",
  "identity-replay",
  "rename-users",
  "shift-timestamps",
  "interleave-threads",
]);
export type Transformation = z.infer<typeof transformationSchema>;

export const reasoningSchema = z.enum(["low", "medium", "high"]);
export type Reasoning = z.infer<typeof reasoningSchema>;

export const pipelineSchema = z.enum(["direct", "deterministic-shell"]);
export type Pipeline = z.infer<typeof pipelineSchema>;

export const messageSchema = z
  .object({
    id: z.number().int().positive(),
    user: z.string().min(1),
    time: z.string().min(1),
    replyTo: z.number().int().positive().nullable().optional(),
    text: z.string().optional(),
    media: z.string().min(1).optional(),
    fixtureThread: z.string().min(1).optional(),
  })
  .strict()
  .refine(
    (message) => message.text !== undefined || message.media !== undefined,
    {
      message: "A message must have text or media",
    },
  );

export type EvalMessage = z.infer<typeof messageSchema>;

export const evidenceItemSchema = z
  .object({
    text: z.string().min(1),
    evidence: z.array(z.number().int().positive()),
  })
  .strict();

export type EvidenceItem = z.infer<typeof evidenceItemSchema>;

const goldItemSchema = evidenceItemSchema.extend({
  id: z.string().min(1),
  weight: z.number().positive().default(1),
});

export const goldSchema = z
  .object({
    threads: z.array(
      z
        .object({
          id: z.string().min(1),
          weight: z.number().positive(),
        })
        .strict(),
    ),
    claims: z.array(
      goldItemSchema.extend({ thread: z.string().min(1) }).strict(),
    ),
    forbidden: z.array(
      z
        .object({
          id: z.string().min(1),
          text: z.string().min(1),
          type: z.string().min(1),
          patterns: z.array(z.string().min(1)).optional(),
        })
        .strict(),
    ),
    decisions: z.array(goldItemSchema.strict()),
    openQuestions: z.array(goldItemSchema.strict()),
    noiseEvidence: z.array(z.number().int().positive()).default([]),
  })
  .strict();

export type Gold = z.infer<typeof goldSchema>;

const mutationExpectationSchema = z
  .object({
    matchedClaimIds: z.array(z.string().min(1)).default([]),
    matchedOpenQuestionIds: z.array(z.string().min(1)).default([]),
    absentForbiddenIds: z.array(z.string().min(1)).default([]),
    maxFalseOpenQuestionRate: z.number().min(0).max(1).optional(),
  })
  .strict();

const mutationRelationSchema = z
  .object({
    id: z.string().min(1),
    baselineCase: z.string().min(1),
    mutantCase: z.string().min(1),
    baselineExpect: mutationExpectationSchema,
    mutantExpect: mutationExpectationSchema,
  })
  .strict();

export const experimentSchema = z
  .object({
    cases: z.array(z.string().min(1)).min(1),
    models: z.array(z.string().min(1)).min(1),
    representations: z.array(representationSchema).min(1),
    reasoning: z.array(reasoningSchema).min(1),
    seeds: z.array(z.number().int()).min(1),
    pipelines: z.array(pipelineSchema).min(1).default(["deterministic-shell"]),
    transformations: z.array(transformationSchema).min(1).default(["identity"]),
    mutations: z.array(mutationRelationSchema).default([]),
    promptVersion: z.string().min(1).default("v1"),
  })
  .strict();

export type Experiment = z.infer<typeof experimentSchema>;
export type MutationExpectation = z.infer<typeof mutationExpectationSchema>;

export type ExtractorMetrics = {
  eventCount: number;
  eventRecall: number | null;
  eventPrecision: number | null;
  attributionAccuracy: number | null;
  evidenceCorrectness: number | null;
  relationIntegrity: number | null;
};

export type ReducerMetrics = {
  deterministic: true;
  lifecycleInvariantViolations: number;
  resolvedQuestions: number;
  supersededEvents: number;
};

export type OperationalMetrics = {
  modelCalls: number;
  sourceMessageWindows: number;
  semanticInterpretations: number;
  semanticAmplification: number;
};

export type StructuralMetrics = {
  validJson: boolean;
  schemaValid: boolean;
  unknownEvidenceIds: number;
  duplicateEvidenceIds: number;
  topicCount: number;
  claimCount: number;
  decisionCount: number;
  openQuestionCount: number;
};

export type Score = StructuralMetrics & {
  majorThreadRecall: number | null;
  weightedClaimRecall: number | null;
  goldClaimPrecision: number | null;
  evidencePrecision: number | null;
  forbiddenRate: number;
  falseOpenQuestionRate: number | null;
  noiseRetention: number | null;
  matchedClaimIds: string[];
  matchedDecisionIds?: string[];
  matchedOpenQuestionIds?: string[];
  retainedThreadIds: string[];
  triggeredForbiddenIds: string[];
};

export type StoredRun = {
  case: string;
  pipeline?: Pipeline;
  transformation?: Transformation;
  model: string;
  representation: Representation;
  reasoning: Reasoning;
  seed: number;
  inputHash: string;
  promptHash: string;
  promptVersion: string;
  status: "ok" | "parse_failure" | "request_failure";
  raw: string;
  thinking: string;
  parsed: ProjectedSummary | null;
  reconstruction?: DiscourseReconstruction | null;
  state?: DiscourseState | null;
  extractorMetrics?: ExtractorMetrics;
  reducerMetrics?: ReducerMetrics;
  operationalMetrics?: OperationalMetrics;
  projectionDiagnostics?: {
    decisionCandidates: number;
    decisionsRejectedByInvariant: number;
    questionsResolvedByAnswerEdge: number;
  };
  parseError?: string;
  requestError?: string;
  usage: {
    durationMs: number;
    ollamaTotalMs?: number;
    loadMs?: number;
    promptEvalCount?: number;
    promptEvalMs?: number;
    evalCount?: number;
    thinkingTextTokenCount?: number;
    finalTextTokenCount?: number;
    evalMs?: number;
    outputTokensPerSecond?: number;
    doneReason?: string;
  };
  metrics: Score;
};

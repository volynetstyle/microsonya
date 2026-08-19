import { z } from "zod";

export const discourseEventSchema = z
  .object({
    id: z.string().min(1),
    topicId: z.string().min(1),
    topicTitle: z.string().min(1),
    speaker: z.string().min(1),
    statement: z.string().min(1),
    speechAct: z.enum([
      "assertion",
      "question",
      "proposal",
      "answer",
      "request",
      "correction",
      "opposition",
    ]),
    literalness: z.enum(["literal", "ironic", "uncertain"]),
    commitment: z.enum(["none", "tentative", "explicit"]),
    epistemicStatus: z.enum(["claimed", "accepted", "rejected", "uncertain"]),
    settled: z.boolean(),
    action: z.string().min(1).nullable(),
    refersTo: z.array(z.string().min(1)),
    stance: z.enum(["support", "oppose", "neutral"]),
    semanticImportance: z.number().min(0).max(1),
    confidence: z.number().min(0).max(1),
    evidence: z.array(z.number().int().positive()).min(1),
  })
  .strict();

export const discourseReconstructionSchema = z
  .object({
    title: z.string().min(1),
    events: z.array(discourseEventSchema),
  })
  .strict();

export type DiscourseEvent = z.infer<typeof discourseEventSchema>;
export type DiscourseReconstruction = z.infer<
  typeof discourseReconstructionSchema
>;

export type DiscourseState = {
  title: string;
  events: DiscourseEvent[];
  resolvedQuestionIds: string[];
  supersededEventIds: string[];
};

export const evidenceItemSchema = z
  .object({
    text: z.string().min(1),
    evidence: z.array(z.number().int().positive()),
  })
  .strict();

export const projectedSummarySchema = z
  .object({
    title: z.string().min(1),
    topics: z.array(
      z
        .object({
          id: z.string().min(1),
          title: z.string().min(1),
          claims: z.array(evidenceItemSchema),
        })
        .strict(),
    ),
    decisions: z.array(evidenceItemSchema),
    openQuestions: z.array(evidenceItemSchema),
  })
  .strict();

export type EvidenceItem = z.infer<typeof evidenceItemSchema>;
export type ProjectedSummary = z.infer<typeof projectedSummarySchema>;

export type ProjectionDiagnostics = {
  decisionCandidates: number;
  decisionsRejectedByInvariant: number;
  questionsResolvedByAnswerEdge: number;
};

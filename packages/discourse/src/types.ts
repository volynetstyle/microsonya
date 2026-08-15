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

export type SegmentReconstruction = {
  segmentId: string;
  chatId: string;
  fromMessageId: number;
  toMessageId: number;
  hash: string;
  reconstruction: DiscourseReconstruction;
};

export type EvidenceItem = { text: string; evidence: number[] };
export type ProjectedSummary = {
  title: string;
  topics: Array<{ id: string; title: string; claims: EvidenceItem[] }>;
  decisions: EvidenceItem[];
  openQuestions: EvidenceItem[];
};

export type ProjectionDiagnostics = {
  decisionCandidates: number;
  decisionsRejectedByInvariant: number;
  questionsResolvedByAnswerEdge: number;
};

export type DiscourseMessage = {
  id: number;
  user: string;
  time: string;
  replyTo?: number | null;
  text?: string;
  media?: string;
};

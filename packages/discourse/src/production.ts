import { z } from "zod";

export const claimSchema = z
  .object({
    topic: z.string().trim().min(1),
    text: z.string().trim().min(1),
    evidence: z.array(z.number().int().positive()).min(1),
  })
  .strict();

export const claimsReconstructionSchema = z
  .object({
    claims: z.array(claimSchema),
  })
  .strict();

export type Claim = z.infer<typeof claimSchema>;
export type ClaimsReconstruction = z.infer<typeof claimsReconstructionSchema>;

export const renderedSummarySchema = z
  .object({
    title: z.string().trim().min(1),
    summary: z.string().trim().min(1),
  })
  .strict();

export type RenderedSummary = z.infer<typeof renderedSummarySchema>;

export type SegmentReconstruction = {
  segmentId: string;
  chatId: string;
  fromMessageId: number;
  toMessageId: number;
  hash: string;
  reconstruction: ClaimsReconstruction;
};

export type DiscourseMessage = {
  id: number;
  user: string;
  time: string;
  replyTo?: number | null;
  text?: string;
  media?: string;
};

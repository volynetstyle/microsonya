import { z } from "zod";
import {
  discourseReconstructionSchema,
  type DiscourseReconstruction,
  type SegmentReconstruction,
} from "@microsonya/discourse";
import type { DiscussionSegment, MemoryOp } from "@microsonya/shared";
import {
  InvalidModelOutputError,
  type ModelCallContext,
  type ModelClient,
} from "./ModelClient.js";

const evidenceSchema = z.array(z.number().int().positive()).min(1);
const memoryTextSchema = z.string().trim().min(1).max(2_000);
const memoryKindSchema = z.enum([
  "fact",
  "decision",
  "open_question",
  "plan",
  "result",
]);
const memoryOpSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("create"),
    kind: memoryKindSchema,
    text: memoryTextSchema,
    evidence: evidenceSchema,
  }),
  z.object({
    type: z.literal("support"),
    targetId: z.string().min(1),
    evidence: evidenceSchema,
  }),
  z.object({
    type: z.literal("update"),
    targetId: z.string().min(1),
    text: memoryTextSchema,
    evidence: evidenceSchema,
  }),
  z.object({
    type: z.literal("resolve"),
    targetId: z.string().min(1),
    text: memoryTextSchema,
    evidence: evidenceSchema,
  }),
  z.object({
    type: z.literal("supersede"),
    targetId: z.string().min(1),
    replacement: memoryTextSchema,
    evidence: evidenceSchema,
  }),
  z.object({
    type: z.literal("retract"),
    targetId: z.string().min(1),
    evidence: evidenceSchema,
  }),
]);
const memoryOpsResponseSchema = z.object({
  operations: z.array(memoryOpSchema).default([]),
});

export class ModelGateway {
  constructor(private readonly client: ModelClient) {}

  async reconstructSegment(
    segment: DiscussionSegment,
    hash: string,
    prompt: string,
    context?: ModelCallContext,
    signal?: AbortSignal,
  ): Promise<SegmentReconstruction> {
    const reconstruction = await this.generateSegmentReconstruction(
      prompt,
      segment,
      context,
      signal,
    );
    return {
      segmentId: segment.id,
      chatId: segment.chatId,
      fromMessageId: segment.fromMessageId,
      toMessageId: segment.toMessageId,
      hash,
      reconstruction,
    };
  }

  async extractMemoryOps(
    prompt: string,
    context?: ModelCallContext,
    signal?: AbortSignal,
  ): Promise<MemoryOp[]> {
    try {
      const response = memoryOpsResponseSchema.parse(
        await this.client.generateObject(
          prompt,
          memoryOpsResponseSchema,
          context,
          signal,
        ),
      );
      return response.operations;
    } catch (error) {
      if (
        !(error instanceof InvalidModelOutputError) &&
        !(error instanceof z.ZodError)
      ) {
        throw error;
      }

      console.warn(
        "Model returned invalid memory operations; applying no memory changes",
        safeStringify({ error: error.message }),
      );
      return [];
    }
  }

  private async generateSegmentReconstruction(
    prompt: string,
    segment: DiscussionSegment,
    context?: ModelCallContext,
    signal?: AbortSignal,
  ): Promise<DiscourseReconstruction> {
    let output: unknown;

    try {
      output = await this.client.generateObject(
        prompt,
        discourseReconstructionSchema,
        context,
        signal,
      );
      return discourseReconstructionSchema.parse(output);
    } catch (error) {
      if (
        !(error instanceof InvalidModelOutputError) &&
        !(error instanceof z.ZodError)
      ) {
        throw error;
      }

      const invalidOutput =
        error instanceof InvalidModelOutputError
          ? error
          : new InvalidModelOutputError({
              cause: error,
              rawText: safeStringify(output),
            });

      console.error(
        "Model returned an invalid discourse reconstruction; segment was not cached",
        safeStringify({
          segmentId: segment.id,
          fromMessageId: segment.fromMessageId,
          toMessageId: segment.toMessageId,
          error: invalidOutput.message,
          rawResponseChars: invalidOutput.rawText?.length,
        }),
      );

      throw invalidOutput;
    }
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

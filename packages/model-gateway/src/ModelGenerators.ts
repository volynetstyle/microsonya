import type { z } from "zod";
import type { ModelCallContext } from "./ModelClient.js";

/** Unconstrained text generation, e.g. plain-text summary merges. */
export interface TextGenerator {
  generateText(
    prompt: string,
    context?: ModelCallContext,
    signal?: AbortSignal,
  ): Promise<string>;
}

/** Schema-constrained generation. */
export interface StructuredGenerator {
  generateObject<T>(
    prompt: string,
    schema: z.ZodType<T>,
    context?: ModelCallContext,
    signal?: AbortSignal,
  ): Promise<T>;
}

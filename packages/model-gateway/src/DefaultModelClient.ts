import type { z } from "zod";
import type { ModelCallContext, ModelClient } from "./ModelClient.js";
import type { StructuredGenerator, TextGenerator } from "./ModelGenerators.js";

/**
 * Composes a text generator and a structured generator into one ModelClient.
 * Which concrete generator backs each capability is decided once at
 * composition time (see createSummarizationModelService.ts) — this class
 * does no branching or provider detection of its own.
 */
export class DefaultModelClient implements ModelClient {
  constructor(
    private readonly textGenerator: TextGenerator,
    private readonly structuredGenerator: StructuredGenerator,
  ) {}

  generateText(
    prompt: string,
    context?: ModelCallContext,
    signal?: AbortSignal,
  ): Promise<string> {
    return this.textGenerator.generateText(prompt, context, signal);
  }

  generateObject<T>(
    prompt: string,
    schema: z.ZodType<T>,
    context?: ModelCallContext,
    signal?: AbortSignal,
  ): Promise<T> {
    return this.structuredGenerator.generateObject(prompt, schema, context, signal);
  }
}

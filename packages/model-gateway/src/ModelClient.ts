import type { z } from "zod";

export type ModelClient = {
  generateText(prompt: string): Promise<string>;
  generateObject<T>(prompt: string, schema: z.ZodType<T>): Promise<T>;
};

export class InvalidModelOutputError extends Error {
  constructor(options?: ErrorOptions) {
    super("Model output did not match the requested schema.", options);
    this.name = "InvalidModelOutputError";
  }
}

import type { z } from "zod";

export type GenerateOptions = {
  signal?: AbortSignal;
  maxOutputTokens?: number;
};

export type Model = {
  generate<T>(
    prompt: string,
    schema: z.ZodType<T>,
    options?: GenerateOptions,
  ): Promise<T>;
};

export class ModelRequestError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ModelRequestError";
  }
}

export class InvalidModelOutputError extends Error {
  readonly rawText?: string;
  constructor(options?: ErrorOptions & { rawText?: string }) {
    super("Model output did not match the requested schema.", options);
    this.name = "InvalidModelOutputError";
    this.rawText = options?.rawText;
  }
}

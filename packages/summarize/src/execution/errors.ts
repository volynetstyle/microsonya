import { OllamaError } from "@microsonya/model";
import { ModelOutputError } from "../model/output.js";
import type { SummaryErrorCode } from "./events.js";

export function serializeError(
  error: unknown,
  code: SummaryErrorCode,
): {
  name?: string;
  code: SummaryErrorCode;
  detailCode?: string;
  outputChars?: number;
  outputPreview?: string;
  message: string;
  stack?: string;
} {
  if (error instanceof Error) {
    return {
      code,
      name: error.name,
      ...(error instanceof ModelOutputError
        ? {
            detailCode: error.code,
            outputChars: error.outputChars,
            ...(includeModelOutputInLogs()
              ? { outputPreview: error.outputPreview }
              : {}),
          }
        : {}),
      message: error.message,
      stack: error.stack,
    };
  }
  return { code, message: String(error) };
}

export function classifySummaryError(
  error: unknown,
  stage: string,
): SummaryErrorCode {
  if (stage === "delivery") return "DELIVERY_ERROR";
  if (error instanceof ModelOutputError) {
    return error.code === "MODEL_OUTPUT_EMPTY"
      ? "MODEL_OUTPUT_EMPTY"
      : "MODEL_OUTPUT_INVALID";
  }
  if (
    error instanceof DOMException
      ? error.name === "AbortError" || error.name === "TimeoutError"
      : error instanceof Error &&
        (error.name === "AbortError" || error.name === "TimeoutError")
  ) {
    return "MODEL_TIMEOUT";
  }
  if (stage === "messages.load" || stage === "disposition.save") {
    return "STORAGE_ERROR";
  }
  if (error instanceof OllamaError || stage === "window.process") {
    return "MODEL_PROVIDER_ERROR";
  }
  return "STORAGE_ERROR";
}

function includeModelOutputInLogs(): boolean {
  return (
    process.env.NODE_ENV === "development" ||
    process.env.SUMMARIZATION_LOG_MODEL_RESPONSE === "1"
  );
}

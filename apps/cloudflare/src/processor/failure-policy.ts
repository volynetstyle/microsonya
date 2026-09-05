import { OllamaError } from "@microsonya/model";
import { classifyUnknownFailure } from "./policy.js";
import { DeliveryError } from "./delivery/telegram-delivery.js";

const DEFAULT_RETRY_SECONDS = 30;

export class LeaseLostError extends Error {
  constructor() {
    super("Processing lease was lost.");
    this.name = "LeaseLostError";
  }
}

export function classifyFailure(error: unknown): {
  readonly code: string;
  readonly retryable: boolean;
  readonly retryAfterSeconds: number;
} {
  if (error instanceof DeliveryError) return error;
  if (error instanceof LeaseLostError)
    return { code: error.name, retryable: true, retryAfterSeconds: 5 };
  if (error instanceof OllamaError)
    return {
      code: `MODEL_HTTP_${error.status ?? "UNKNOWN"}`,
      retryable: error.status === 429 || (error.status ?? 500) >= 500,
      retryAfterSeconds: DEFAULT_RETRY_SECONDS,
    };
  if (error instanceof TypeError) {
    const code = KNOWN_TYPE_ERROR_CODES[error.message];
    if (code !== undefined)
      return {
        code,
        retryable: false,
        retryAfterSeconds: DEFAULT_RETRY_SECONDS,
      };
  }
  return classifyUnknownFailure(error);
}

const KNOWN_TYPE_ERROR_CODES: Readonly<Record<string, string>> = Object.freeze({
  "Summary ledger encryption key must be 32 bytes.":
    "CONFIG_DATA_ENCRYPTION_KEY_INVALID",
  "Invalid summary ledger ciphertext envelope.":
    "DATA_CIPHERTEXT_ENVELOPE_INVALID",
  "Persisted summary attempt has no presentation.":
    "PERSISTED_ATTEMPT_UNPRESENTABLE",
  "Unsupported PostgreSQL bytea driver value.":
    "DATA_BYTEA_DRIVER_VALUE_UNSUPPORTED",
  "Terminal summary text is missing ciphertext.":
    "LEGACY_SUMMARY_PRESENTATION_MISSING",
});

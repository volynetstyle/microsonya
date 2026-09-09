import type { SummaryCommand, SummaryId } from "@microsonya/shared";

/** Portable protocol for idempotent creation of one logical summary run. */
export interface CreateSummaryRunRequest {
  readonly idempotencyKey: string;
  readonly command: SummaryCommand;
}

export interface CreateSummaryRunResponse {
  readonly runId: SummaryId;
}

/** Queue transports work identity; PostgreSQL remains the source of truth. */
export interface SummaryJob {
  readonly runId: SummaryId;
}

export type ProcessSummaryRunResult =
  | { readonly disposition: "completed" }
  | { readonly disposition: "permanent-failure" }
  | { readonly disposition: "retry"; readonly retryAfterSeconds?: number };

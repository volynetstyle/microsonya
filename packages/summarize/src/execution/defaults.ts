import type { SummaryId, TimestampMs } from "@microsonya/shared";
import { asSummaryId, asTimestampMs } from "@microsonya/shared";
import { randomUUID } from "node:crypto";

export function defaultSummaryId(): SummaryId {
  return asSummaryId(randomUUID());
}

export function defaultNow(): TimestampMs {
  return asTimestampMs(Date.now());
}

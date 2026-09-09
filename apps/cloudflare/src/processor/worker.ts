import { WorkerEntrypoint } from "cloudflare:workers";
import type { ProcessSummaryRunResult } from "@microsonya/contracts";
import type { SummaryId } from "@microsonya/shared";
import { SummaryExecutionProcessor } from "./process-summary-execution.js";

/** Service Binding entrypoint; execution policy lives outside the platform shell. */
export class SummaryProcessorEntrypoint extends WorkerEntrypoint<Env> {
  process(executionId: SummaryId): Promise<ProcessSummaryRunResult> {
    return new SummaryExecutionProcessor(this.env).process(executionId);
  }
}

export default {
  fetch(): Response {
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

export { classifyFailure } from "./failure-policy.js";
export { presentGeneratedDisposition } from "./recover-accepted-outcome.js";

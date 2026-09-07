import type { SummaryJob } from "@microsonya/contracts";
import {
  createSummaryQueueObservability,
  type SummaryQueueObservability,
} from "./summary-queue-observability.js";

type QueueEnv = Pick<Env, "SUMMARY_PROCESSOR" | "SUMMARY_JOBS" | "ANALYTICS">;

export async function handleSummaryQueue(
  batch: MessageBatch<SummaryJob>,
  env: QueueEnv,
): Promise<void> {
  const observability = createSummaryQueueObservability(env.ANALYTICS);
  for (const message of batch.messages) {
    const body: unknown = message.body;
    if (!isSummaryJob(body)) {
      // Poison messages cannot become valid on retry. ACK first so auxiliary
      // observability can never prevent their removal from the queue.
      message.ack();
      observability.malformedJob(message.id);
      continue;
    }
    await processSummaryMessage(env, message, body, observability);
  }
}

async function processSummaryMessage(
  env: QueueEnv,
  message: Message<SummaryJob>,
  job: SummaryJob,
  observability: SummaryQueueObservability,
): Promise<void> {
  let result: Awaited<ReturnType<Env["SUMMARY_PROCESSOR"]["process"]>>;
  try {
    result = await env.SUMMARY_PROCESSOR.process(job.runId);
  } catch (error) {
    // Never log raw errors: RPC exceptions can carry processor parameters,
    // including encrypted values. The run id and safe error name are enough
    // to recover the authoritative state from PostgreSQL.
    message.retry();
    observability.processorRpcFailed(job.runId, error);
    return;
  }

  observability.disposition(job.runId, result);

  switch (result.disposition) {
    case "completed":
      message.ack();
      return;
    case "permanent-failure":
      message.ack();
      return;
    case "retry":
      await rescheduleLogicalRun(
        env,
        message,
        job,
        observability,
        result.retryAfterSeconds,
      );
  }
}

async function rescheduleLogicalRun(
  env: QueueEnv,
  message: Message<SummaryJob>,
  job: SummaryJob,
  observability: SummaryQueueObservability,
  retryAfterSeconds?: number,
): Promise<void> {
  const options =
    retryAfterSeconds === undefined
      ? undefined
      : { delaySeconds: retryAfterSeconds };
  try {
    await env.SUMMARY_JOBS.send(job, options);
    // ACK only after the replacement message is durably accepted. Metrics
    // happen afterwards and are explicitly best-effort.
    message.ack();
    observability.rescheduled();
  } catch (error) {
    message.retry(options);
    observability.rescheduleFailed(job.runId, error);
  }
}

function isSummaryJob(value: unknown): value is SummaryJob {
  if (typeof value !== "object" || value === null) return false;
  const runId = (value as { readonly runId?: unknown }).runId;
  return typeof runId === "string" && runId.trim().length > 0;
}

export default {} satisfies ExportedHandler;

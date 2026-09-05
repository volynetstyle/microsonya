import type { SummaryJob } from "@microsonya/contracts";
import { tracing } from "cloudflare:workers";
import {
  errorName,
  logTelemetry,
  recordTelemetryMetric,
} from "../observability.js";

type QueueEnv = Pick<Env, "SUMMARY_PROCESSOR" | "SUMMARY_JOBS" | "ANALYTICS">;

export async function handleSummaryQueue(
  batch: MessageBatch<SummaryJob>,
  env: QueueEnv,
): Promise<void> {
  for (const message of batch.messages) {
    const body: unknown = message.body;
    if (!isSummaryJob(body)) {
      // Poison messages cannot become valid on retry. ACK first so auxiliary
      // observability can never prevent their removal from the queue.
      message.ack();
      logTelemetry("error", "ingress", "summary.queue.malformed_job", {
        messageId: message.id,
      });
      recordQueueSignal(env, "summary.queue", "malformed");
      continue;
    }
    await tracing.enterSpan("summary.queue_message", async (span) => {
      span.setAttribute("microsonya.run_id", body.runId);
      await processSummaryMessage(env, message, body);
    });
  }
}

async function processSummaryMessage(
  env: QueueEnv,
  message: Message<SummaryJob>,
  job: SummaryJob,
): Promise<void> {
  let result: Awaited<ReturnType<Env["SUMMARY_PROCESSOR"]["process"]>>;
  try {
    result = await env.SUMMARY_PROCESSOR.process(job.runId);
  } catch (error) {
    // Never log raw errors: RPC exceptions can carry processor parameters,
    // including encrypted values. The run id and safe error name are enough
    // to recover the authoritative state from PostgreSQL.
    logTelemetry("error", "ingress", "summary.queue.processor_rpc_error", {
      runId: job.runId,
      errorName: errorName(error),
    });
    message.retry();
    recordQueueSignal(env, "summary.queue.processor_rpc", "error");
    return;
  }

  logTelemetry("info", "ingress", "summary.queue.disposition", {
    runId: job.runId,
    disposition: result.disposition,
    retryAfterSeconds:
      result.disposition === "retry" ? result.retryAfterSeconds : undefined,
  });

  switch (result.disposition) {
    case "completed":
      message.ack();
      recordQueueSignal(env, "summary.queue", "completed");
      return;
    case "permanent-failure":
      message.ack();
      recordQueueSignal(env, "summary.queue", "failed_permanent");
      return;
    case "retry":
      await rescheduleLogicalRun(env, message, job, result.retryAfterSeconds);
  }
}

async function rescheduleLogicalRun(
  env: QueueEnv,
  message: Message<SummaryJob>,
  job: SummaryJob,
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
    recordQueueSignal(env, "summary.queue", "rescheduled");
  } catch (error) {
    logTelemetry("error", "ingress", "summary.queue.reschedule_error", {
      runId: job.runId,
      errorName: errorName(error),
    });
    message.retry(options);
    recordQueueSignal(env, "summary.queue.reschedule", "error");
  }
}

function isSummaryJob(value: unknown): value is SummaryJob {
  if (typeof value !== "object" || value === null) return false;
  const runId = (value as { readonly runId?: unknown }).runId;
  return typeof runId === "string" && runId.trim().length > 0;
}

function recordQueueSignal(
  env: QueueEnv,
  event: string,
  signal:
    | "completed"
    | "failed_permanent"
    | "rescheduled"
    | "error"
    | "malformed",
): void {
  recordTelemetryMetric(env.ANALYTICS, "ingress", event, signal);
}

export default {} satisfies ExportedHandler;

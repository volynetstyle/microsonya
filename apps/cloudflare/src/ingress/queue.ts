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
      logTelemetry("error", "ingress", "summary.queue.malformed_job", {
        messageId: message.id,
      });
      recordQueueSignal(env, "summary.queue", "malformed");
      message.ack();
      continue;
    }
    await tracing.enterSpan("summary.queue_message", async (span) => {
      span.setAttribute("microsonya.run_id", body.runId);
      try {
        const result = await env.SUMMARY_PROCESSOR.process(body.runId);
        logTelemetry("info", "ingress", "summary.queue.disposition", {
          runId: body.runId,
          disposition: result.disposition,
          retryAfterSeconds:
            result.disposition === "retry"
              ? result.retryAfterSeconds
              : undefined,
        });
        switch (result.disposition) {
          case "completed":
            recordQueueSignal(env, "summary.queue", "completed");
            message.ack();
            break;
          case "permanent-failure":
            recordQueueSignal(env, "summary.queue", "failed_permanent");
            message.ack();
            break;
          case "retry":
            await rescheduleLogicalRun(
              env,
              message,
              body,
              result.retryAfterSeconds,
            );
            break;
        }
      } catch (error) {
        // Never log raw errors: RPC exceptions can carry processor
        // parameters, including encrypted values. The run id remains enough
        // to recover the authoritative state from PostgreSQL.
        logTelemetry("error", "ingress", "summary.queue.processor_rpc_error", {
          runId: body.runId,
          errorName: errorName(error),
        });
        recordQueueSignal(env, "summary.queue.processor_rpc", "error");
        message.retry();
      }
    });
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
    recordQueueSignal(env, "summary.queue", "rescheduled");
    message.ack();
  } catch (error) {
    logTelemetry("error", "ingress", "summary.queue.reschedule_error", {
      runId: job.runId,
      errorName: errorName(error),
    });
    recordQueueSignal(env, "summary.queue.reschedule", "error");
    message.retry(options);
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

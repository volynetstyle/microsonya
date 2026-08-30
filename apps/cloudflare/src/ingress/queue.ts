import type { SummaryJob } from "@microsonya/contracts";
import { tracing } from "cloudflare:workers";

type QueueEnv = Pick<Env, "SUMMARY_PROCESSOR" | "SUMMARY_JOBS" | "ANALYTICS">;

export async function handleSummaryQueue(
  batch: MessageBatch<SummaryJob>,
  env: QueueEnv,
): Promise<void> {
  for (const message of batch.messages) {
    const body: unknown = message.body;
    if (!isSummaryJob(body)) {
      console.error("summary.queue.malformed_job", { messageId: message.id });
      recordQueueSignal(env, message.id, "malformed");
      message.ack();
      continue;
    }
    await tracing.enterSpan("summary.queue_message", async (span) => {
      span.setAttribute("microsonya.run_id", body.runId);
      try {
        const result = await env.SUMMARY_PROCESSOR.process(body.runId);
        console.info("summary.queue.disposition", {
          runId: body.runId,
          disposition: result.disposition,
          retryAfterSeconds:
            result.disposition === "retry"
              ? result.retryAfterSeconds
              : undefined,
        });
        switch (result.disposition) {
          case "completed":
            recordQueueSignal(env, body.runId, "completed");
            message.ack();
            break;
          case "permanent-failure":
            recordQueueSignal(env, body.runId, "failed_permanent");
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
        console.error("summary.queue.processor_rpc_error", {
          runId: body.runId,
          errorName: error instanceof Error ? error.name : "UNKNOWN_ERROR",
        });
        recordQueueSignal(env, body.runId, "rpc_error");
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
    recordQueueSignal(env, job.runId, "rescheduled");
    message.ack();
  } catch (error) {
    console.error("summary.queue.reschedule_error", {
      runId: job.runId,
      errorName: error instanceof Error ? error.name : "UNKNOWN_ERROR",
    });
    recordQueueSignal(env, job.runId, "reschedule_error");
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
  runId: string,
  signal:
    | "completed"
    | "failed_permanent"
    | "rescheduled"
    | "reschedule_error"
    | "rpc_error"
    | "malformed",
): void {
  env.ANALYTICS.writeDataPoint({
    indexes: [runId],
    blobs: [signal],
    doubles: [Date.now()],
  });
}

export default {} satisfies ExportedHandler;

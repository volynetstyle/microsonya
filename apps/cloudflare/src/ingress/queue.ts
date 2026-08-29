import type { SummaryJob } from "@microsonya/contracts";
import { tracing } from "cloudflare:workers";

type QueueEnv = Pick<Env, "SUMMARY_PROCESSOR" | "ANALYTICS">;

export async function handleSummaryQueue(
  batch: MessageBatch<SummaryJob>,
  env: QueueEnv,
): Promise<void> {
  for (const message of batch.messages) {
    await tracing.enterSpan("summary.queue_message", async (span) => {
      span.setAttribute("microsonya.run_id", message.body.runId);
      try {
        const result = await env.SUMMARY_PROCESSOR.process(message.body.runId);
        switch (result.disposition) {
          case "completed":
            recordQueueSignal(env, message.body.runId, "completed");
            message.ack();
            break;
          case "permanent-failure":
            recordQueueSignal(env, message.body.runId, "failed_permanent");
            message.ack();
            break;
          case "retry":
            recordQueueSignal(env, message.body.runId, "retry");
            message.retry(
              result.retryAfterSeconds === undefined
                ? undefined
                : { delaySeconds: result.retryAfterSeconds },
            );
            break;
        }
      } catch {
        recordQueueSignal(env, message.body.runId, "rpc_error");
        message.retry();
      }
    });
  }
}

function recordQueueSignal(
  env: QueueEnv,
  runId: string,
  signal: "completed" | "failed_permanent" | "retry" | "rpc_error",
): void {
  env.ANALYTICS.writeDataPoint({
    indexes: [runId],
    blobs: [signal],
    doubles: [Date.now()],
  });
}

export default {} satisfies ExportedHandler;

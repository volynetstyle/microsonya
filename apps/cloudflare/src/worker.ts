import type {
  CreateSummaryRunRequest,
  SummaryJob,
} from "@microsonya/contracts";
import { parseSummaryCommandUpdate } from "@microsonya/telegram";

const TELEGRAM_WEBHOOK_PATH = "/telegram";
type CloudflareEnv = Omit<Env, "SUMMARY_JOBS"> & {
  readonly SUMMARY_JOBS: Queue<SummaryJob>;
};

const worker = {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== TELEGRAM_WEBHOOK_PATH) {
      return new Response("Not found", { status: 404 });
    }
    if (request.method !== "POST") {
      return new Response("Method not allowed", {
        status: 405,
        headers: { allow: "POST" },
      });
    }
    if (!hasTelegramWebhookSecret(request, env.TELEGRAM_WEBHOOK_SECRET)) {
      return new Response("Unauthorized", { status: 401 });
    }

    const command = parseSummaryCommandUpdate(
      await request.json(),
      env.BOT_USERNAME,
    );
    if (command === undefined) return new Response("OK");

    const createRequest: CreateSummaryRunRequest = {
      idempotencyKey: `telegram:${command.chatId}:${command.commandMessageId}`,
      command,
    };
    const run = await env.SUMMARY_RUNS.create(createRequest);
    await env.SUMMARY_JOBS.send({ runId: run.runId } satisfies SummaryJob);
    await env.SUMMARY_RUNS.markQueued(run.runId);
    recordRunSignal(env, run.runId, "created");

    // Telegram is acknowledged only after the durable run exists and Queue
    // has accepted the job. Repeated updates resolve to the same logical run.
    return new Response("OK");
  },

  async queue(batch: MessageBatch<SummaryJob>, env): Promise<void> {
    await handleSummaryQueue(batch, env);
  },
} satisfies ExportedHandler<CloudflareEnv, SummaryJob>;

export default worker;

export async function handleSummaryQueue(
  batch: MessageBatch<SummaryJob>,
  env: Pick<CloudflareEnv, "SUMMARY_PROCESSOR" | "ANALYTICS">,
): Promise<void> {
  for (const message of batch.messages) {
    try {
      const result = await env.SUMMARY_PROCESSOR.process(message.body.runId);
      switch (result.disposition) {
        case "completed":
          recordRunSignal(env, message.body.runId, "completed");
          message.ack();
          break;
        case "permanent-failure":
          recordRunSignal(env, message.body.runId, "failed_permanent");
          message.ack();
          break;
        case "retry":
          recordRunSignal(env, message.body.runId, "retry");
          message.retry(
            result.retryAfterSeconds === undefined
              ? undefined
              : { delaySeconds: result.retryAfterSeconds },
          );
          break;
      }
    } catch {
      // RPC/network exceptions are transient. Business failures are returned
      // explicitly by the processor and handled above.
      recordRunSignal(env, message.body.runId, "rpc_error");
      message.retry();
    }
  }
}

function hasTelegramWebhookSecret(request: Request, expected: string): boolean {
  return (
    expected.length > 0 &&
    request.headers.get("X-Telegram-Bot-Api-Secret-Token") === expected
  );
}

function recordRunSignal(
  env: Pick<CloudflareEnv, "ANALYTICS">,
  runId: string,
  signal: "created" | "completed" | "failed_permanent" | "retry" | "rpc_error",
): void {
  env.ANALYTICS.writeDataPoint({
    indexes: [runId],
    blobs: [signal],
    doubles: [Date.now()],
  });
}

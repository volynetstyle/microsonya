import type {
  CreateSummaryRunRequest,
  SummaryJob,
} from "@microsonya/contracts";
import { MessagesRepo, dataEncryptionFromBase64, openDb } from "@microsonya/db";
import {
  parseSummaryCommandUpdate,
  parseTelegramChatMessageUpdate,
} from "@microsonya/telegram";
import { tracing } from "cloudflare:workers";
import { handleSummaryQueue } from "./queue.js";

const TELEGRAM_WEBHOOK_PATH = "/telegram";
type CloudflareEnv = Omit<Env, "SUMMARY_JOBS"> & {
  readonly SUMMARY_JOBS: Queue<SummaryJob>;
};
let cachedMessages:
  | { readonly connectionString: string; readonly repo: MessagesRepo }
  | undefined;

function messages(env: CloudflareEnv): MessagesRepo {
  if (cachedMessages?.connectionString === env.HYPERDRIVE.connectionString) {
    return cachedMessages.repo;
  }
  const client = openDb(env.HYPERDRIVE.connectionString);
  const repo = new MessagesRepo(
    client.db,
    dataEncryptionFromBase64(env.MICROSONYA_DATA_ENCRYPTION_KEY),
  );
  cachedMessages = { connectionString: env.HYPERDRIVE.connectionString, repo };
  return repo;
}

const worker = {
  async fetch(request, env): Promise<Response> {
    return tracing.enterSpan("telegram.ingress", async (span) => {
      span.setAttribute("microsonya.transport", "telegram");
      return handleTelegramIngress(request, env, span);
    });
  },

  async queue(batch: MessageBatch<SummaryJob>, env): Promise<void> {
    await handleSummaryQueue(batch, env);
  },
} satisfies ExportedHandler<CloudflareEnv, SummaryJob>;

export default worker;

async function handleTelegramIngress(
  request: Request,
  env: CloudflareEnv,
  span: Span,
): Promise<Response> {
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

  const update: unknown = await request.json();
  const chatMessage = parseTelegramChatMessageUpdate(update);
  if (chatMessage !== undefined) {
    await tracing.enterSpan("telegram.message.persist", (persistSpan) => {
      persistSpan.setAttribute("microsonya.chat_id", chatMessage.chatId);
      persistSpan.setAttribute("microsonya.message_id", chatMessage.id);
      return messages(env).save(chatMessage);
    });
  }

  const command = parseSummaryCommandUpdate(update, env.BOT_USERNAME);
  if (command === undefined) return new Response("OK");
  span.setAttribute("microsonya.command_mode", command.mode);

  const createRequest: CreateSummaryRunRequest = {
    idempotencyKey: `telegram:${command.chatId}:${command.commandMessageId}`,
    command,
  };
  const run = await tracing.enterSpan("summary_run.create", (createSpan) => {
    createSpan.setAttribute("microsonya.command_mode", command.mode);
    return env.SUMMARY_RUNS.create(createRequest);
  });
  span.setAttribute("microsonya.run_id", run.runId);
  await env.SUMMARY_JOBS.send({ runId: run.runId } satisfies SummaryJob);
  await env.SUMMARY_RUNS.markQueued(run.runId);
  recordRunSignal(env, run.runId, "created");

  // Telegram is acknowledged only after the durable run exists and Queue
  // has accepted the job. Repeated updates resolve to the same logical run.
  return new Response("OK");
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
  signal: "created",
): void {
  env.ANALYTICS.writeDataPoint({
    indexes: [runId],
    blobs: [signal],
    doubles: [Date.now()],
  });
}

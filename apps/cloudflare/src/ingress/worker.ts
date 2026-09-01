import type {
  CreateSummaryRunRequest,
  SummaryJob,
} from "@microsonya/contracts";
import { MessagesRepo } from "@microsonya/db";
import {
  createAppLauncherMessage,
  parseAppCommandUpdate,
  parseSummaryCommandUpdate,
  parseTelegramChatMessageUpdate,
} from "@microsonya/telegram";
import { tracing } from "cloudflare:workers";
import { timingSafeEqual } from "node:crypto";
import { handleSummaryQueue } from "./queue.js";
import { logTelemetry, recordTelemetryMetric } from "../observability.js";
import { withWorkerDatabase } from "../runtime/worker-db.js";

const TELEGRAM_WEBHOOK_PATH = "/telegram";
type CloudflareEnv = Omit<Env, "SUMMARY_JOBS"> & {
  readonly SUMMARY_JOBS: Queue<SummaryJob>;
};
async function withMessages<T>(
  env: CloudflareEnv,
  operation: (repo: MessagesRepo) => Promise<T>,
): Promise<T> {
  return withWorkerDatabase(env, (db, encryption) =>
    operation(new MessagesRepo(db, encryption)),
  );
}

const worker = {
  async fetch(request, env, context): Promise<Response> {
    return tracing.enterSpan("telegram.ingress", async (span) => {
      span.setAttribute("microsonya.transport", "telegram");
      return handleTelegramIngress(request, env, span, context);
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
  context: ExecutionContext,
): Promise<Response> {
  const startedAt = Date.now();
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
  const appCommand = parseAppCommandUpdate(update, env.BOT_USERNAME);
  if (appCommand !== undefined) {
    span.setAttribute("microsonya.command", "app");
    await sendAppLauncher(
      env,
      createAppLauncherMessage(appCommand, env.BOT_USERNAME),
    );
    return new Response("OK");
  }

  const chatMessage = parseTelegramChatMessageUpdate(update);
  if (chatMessage !== undefined) {
    await tracing.enterSpan("telegram.message.persist", (persistSpan) => {
      persistSpan.setAttribute("microsonya.message_kind", "chat_message");
      return withMessages(env, (repo) => repo.save(chatMessage));
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
  context.waitUntil(
    env.SUMMARY_RUNS.markQueued(run.runId).catch((error: unknown) => {
      logTelemetry("warn", "ingress", "summary.run.mark_queued_failed", {
        runId: run.runId,
        errorName: error instanceof Error ? error.name : "UNKNOWN_ERROR",
      });
      return false;
    }),
  );
  const durationMs = Date.now() - startedAt;
  logTelemetry("info", "ingress", "summary.run.accepted", {
    runId: run.runId,
    disposition: "created",
    totalMs: durationMs,
  });
  recordTelemetryMetric(
    env.ANALYTICS,
    "ingress",
    "summary.run.accepted",
    "created",
    durationMs,
  );

  // Telegram is acknowledged after the durable run exists and Queue accepts
  // the job. The queued marker is recoverable bookkeeping: created runs are
  // reconciled and enqueueing/processing are idempotent.
  return new Response("OK");
}

async function sendAppLauncher(
  env: CloudflareEnv,
  body: Readonly<Record<string, unknown>>,
): Promise<void> {
  const response = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  const payload: unknown = await response.json();
  if (!response.ok || !isTelegramSuccess(payload)) {
    logTelemetry("error", "ingress", "telegram.app_launcher.failed", {
      errorCode: `TELEGRAM_HTTP_${response.status}`,
    });
    throw new Error(
      `Telegram app launcher failed with HTTP ${response.status}.`,
    );
  }
}

function isTelegramSuccess(payload: unknown): boolean {
  return (
    typeof payload === "object" &&
    payload !== null &&
    (payload as { readonly ok?: unknown }).ok === true
  );
}

function hasTelegramWebhookSecret(request: Request, expected: string): boolean {
  const actual = request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
  if (expected.length === 0 || actual.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

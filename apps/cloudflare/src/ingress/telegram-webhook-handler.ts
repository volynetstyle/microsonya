import {
  createAppLauncherMessage,
  parseAppCommandUpdate,
  parseSummaryCommandUpdate,
  parseTelegramChatMessageUpdate,
} from "@microsonya/telegram";
import { timingSafeEqual } from "node:crypto";
import { logTelemetry } from "../observability.js";
import { isRetryableTelegramStatus } from "./policy.js";
import { acceptSummaryCommand } from "./summary-command-ingress.js";
import { persistTelegramMessage } from "./telegram-message-ingress.js";

const TELEGRAM_WEBHOOK_PATH = "/telegram";

export async function handleTelegramWebhook(
  request: Request,
  env: Env,
  span: Span,
  context: ExecutionContext,
): Promise<Response> {
  const startedAt = Date.now();
  const url = new URL(request.url);
  if (url.pathname !== TELEGRAM_WEBHOOK_PATH)
    return new Response("Not found", { status: 404 });
  if (request.method !== "POST")
    return new Response("Method not allowed", {
      status: 405,
      headers: { allow: "POST" },
    });
  if (!hasTelegramWebhookSecret(request, env.TELEGRAM_WEBHOOK_SECRET))
    return new Response("Unauthorized", { status: 401 });

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

  const message = parseTelegramChatMessageUpdate(update);
  if (message !== undefined) await persistTelegramMessage(env, message);

  const command = parseSummaryCommandUpdate(update, env.BOT_USERNAME);
  if (command === undefined) return new Response("OK");
  span.setAttribute("microsonya.command_mode", command.mode);
  await acceptSummaryCommand(env, command, context, startedAt);
  return new Response("OK");
}

async function sendAppLauncher(
  env: Env,
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
  if (response.ok && isTelegramSuccess(payload)) return;
  logTelemetry("error", "ingress", "telegram.app_launcher.failed", {
    errorCode: `TELEGRAM_HTTP_${response.status}`,
  });
  if (isRetryableTelegramStatus(response.status))
    throw new Error(
      `Telegram app launcher failed with HTTP ${response.status}.`,
    );
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
  return (
    expected.length > 0 &&
    actual.length === expected.length &&
    timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
  );
}

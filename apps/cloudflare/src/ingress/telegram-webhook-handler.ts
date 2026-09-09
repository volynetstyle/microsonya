import {
  createAppLauncherMessage,
  parseAppCommandUpdate,
  parseSummaryCommandUpdate,
  parseTelegramChatMessageUpdate,
} from "@microsonya/telegram";
import { acceptSummaryCommand } from "./summary-command-ingress.js";
import { persistTelegramMessage } from "./telegram-message-ingress.js";
import { timingSafeEqual } from "node:crypto";

const TELEGRAM_WEBHOOK_PATH = "/telegram";
const encoder = new TextEncoder();

export async function handleTelegramWebhook(
  request: Request,
  env: Env,
  span: Span,
  context: ExecutionContext,
): Promise<Response> {
  const receivedAt = Date.now();
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

  let update: unknown;

  try {
    update = await request.json();
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;

    span.setAttribute("microsonya.telegram.update_kind", "malformed");

    return accepted();
  }

  const appCommand = parseAppCommandUpdate(update, env.BOT_USERNAME);

  if (appCommand !== undefined) {
    span.setAttribute("microsonya.telegram.update_kind", "app_command");

    return telegramMethodResponse(
      "sendMessage",
      createAppLauncherMessage(appCommand, env.BOT_USERNAME),
    );
  }

  const summaryCommand = parseSummaryCommandUpdate(update, env.BOT_USERNAME);

  if (summaryCommand !== undefined) {
    span.setAttribute("microsonya.telegram.update_kind", "summary_command");
    span.setAttribute("microsonya.summary.mode", summaryCommand.mode);

    await acceptSummaryCommand(env, summaryCommand, context, receivedAt);

    return accepted();
  }

  const message = parseTelegramChatMessageUpdate(update);

  if (message !== undefined) {
    span.setAttribute("microsonya.telegram.update_kind", "message");

    await persistTelegramMessage(env, message);
  } else {
    span.setAttribute("microsonya.telegram.update_kind", "ignored");
  }

  return accepted();
}

function accepted(): Response {
  return new Response(null, { status: 204 });
}

function telegramMethodResponse(
  method: string,
  body: Readonly<Record<string, unknown>>,
): Response {
  return Response.json({
    method,
    ...body,
  });
}

function hasTelegramWebhookSecret(request: Request, expected: string): boolean {
  if (expected.length === 0) return false;

  const actual = request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";

  const actualBytes = encoder.encode(actual);
  const expectedBytes = encoder.encode(expected);

  return (
    actualBytes.byteLength === expectedBytes.byteLength &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}

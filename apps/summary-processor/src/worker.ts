import { WorkerEntrypoint } from "cloudflare:workers";
import {
  MessagesRepo,
  SummariesRepo,
  dataEncryptionFromBase64,
  openDb,
} from "@microsonya/db";
import { OllamaClient, OllamaError } from "@microsonya/model";
import type { ProcessSummaryRunResult } from "@microsonya/contracts";
import { asTimestampMs, type SummaryId } from "@microsonya/shared";
import { createSummarizer, presentDisposition } from "@microsonya/summarize";

const DEFAULT_RETRY_SECONDS = 30;
const MAX_ATTEMPTS = 4;
const TELEGRAM_TEXT_LIMIT = 4_096;

type Services = {
  readonly connectionString: string;
  readonly messages: MessagesRepo;
  readonly summaries: SummariesRepo;
  readonly ollama: OllamaClient;
};

let cached: Services | undefined;

function services(env: Env): Services {
  if (cached?.connectionString === env.HYPERDRIVE.connectionString)
    return cached;
  const client = openDb(env.HYPERDRIVE.connectionString);
  const encryption = dataEncryptionFromBase64(
    env.MICROSONYA_DATA_ENCRYPTION_KEY,
  );
  cached = {
    connectionString: env.HYPERDRIVE.connectionString,
    messages: new MessagesRepo(client.db, encryption),
    summaries: new SummariesRepo(client.db, encryption),
    ollama: new OllamaClient({
      baseUrl: env.OLLAMA_BASE_URL,
      apiKey: env.OLLAMA_API_KEY,
    }),
  };
  return cached;
}

export class SummaryProcessorEntrypoint extends WorkerEntrypoint<Env> {
  async process(runId: SummaryId): Promise<ProcessSummaryRunResult> {
    const existing = await this.env.SUMMARY_RUNS.get(runId);
    if (existing === undefined) return { disposition: "permanent-failure" };
    if (
      existing.status === "completed" ||
      existing.status === "failed_permanent"
    ) {
      return {
        disposition:
          existing.status === "completed" ? "completed" : "permanent-failure",
      };
    }

    if (
      existing.status === "summary_ready" ||
      existing.status === "delivering"
    ) {
      return this.deliver(runId, existing.command.chatId, existing.summary);
    }

    const claimed = await this.env.SUMMARY_RUNS.claim(
      runId,
      this.env.PROCESSOR_VERSION,
    );
    if (claimed === undefined)
      return { disposition: "retry", retryAfterSeconds: 5 };

    try {
      const deps = services(this.env);
      const summarizer = createSummarizer({
        messages: deps.messages,
        summaries: deps.summaries,
        ollama: deps.ollama,
        createSummaryId: () => runId,
        now: () => asTimestampMs(Date.now()),
      });
      const disposition = await summarizer.process(claimed.command);
      const summary =
        disposition === null
          ? "Немає нових повідомлень для підсумку."
          : presentDisposition(disposition);
      const validationError = validateSummary(summary);
      if (validationError !== undefined) {
        await this.env.SUMMARY_RUNS.markFailed(runId, validationError);
        return { disposition: "permanent-failure" };
      }
      const saved = await this.env.SUMMARY_RUNS.saveSummary(runId, summary, {
        model: "configured-profile",
        promptVersion: "summarize-package",
      });
      if (!saved) return { disposition: "retry", retryAfterSeconds: 5 };
      return this.deliver(runId, claimed.command.chatId, summary);
    } catch (error) {
      return this.handleProcessingError(runId, claimed.attempt, error);
    }
  }

  private async deliver(
    runId: SummaryId,
    chatId: string,
    summary: string | undefined,
  ): Promise<ProcessSummaryRunResult> {
    if (summary === undefined) {
      await this.env.SUMMARY_RUNS.markFailed(runId, "SUMMARY_MISSING");
      return { disposition: "permanent-failure" };
    }
    const delivering = await this.env.SUMMARY_RUNS.transition(
      runId,
      "summary_ready",
      "delivering",
    );
    if (!delivering) {
      const current = await this.env.SUMMARY_RUNS.get(runId);
      if (current?.status === "completed") return { disposition: "completed" };
      if (current?.status !== "delivering") {
        return { disposition: "retry", retryAfterSeconds: 5 };
      }
    }

    try {
      const messageId = await sendTelegramMessage(
        this.env.TELEGRAM_BOT_TOKEN,
        chatId,
        summary,
      );
      const persisted = await this.env.SUMMARY_RUNS.markCompleted(
        runId,
        messageId,
      );
      return persisted
        ? { disposition: "completed" }
        : { disposition: "retry", retryAfterSeconds: 5 };
    } catch (error) {
      const failure = classifyFailure(error);
      if (!failure.retryable) {
        await this.env.SUMMARY_RUNS.markFailed(runId, failure.code);
        return { disposition: "permanent-failure" };
      }
      await this.env.SUMMARY_RUNS.markRetry(
        runId,
        "delivering",
        failure.code,
        failure.retryAfterSeconds,
      );
      return {
        disposition: "retry",
        retryAfterSeconds: failure.retryAfterSeconds,
      };
    }
  }

  private async handleProcessingError(
    runId: SummaryId,
    attempt: number,
    error: unknown,
  ): Promise<ProcessSummaryRunResult> {
    const failure = classifyFailure(error);
    if (!failure.retryable || attempt >= MAX_ATTEMPTS) {
      await this.env.SUMMARY_RUNS.markFailed(runId, failure.code);
      return { disposition: "permanent-failure" };
    }
    await this.env.SUMMARY_RUNS.markRetry(
      runId,
      "processing",
      failure.code,
      failure.retryAfterSeconds,
    );
    return {
      disposition: "retry",
      retryAfterSeconds: failure.retryAfterSeconds,
    };
  }
}

function validateSummary(summary: string): string | undefined {
  if (summary.trim().length === 0) return "SUMMARY_EMPTY";
  if (summary.length > TELEGRAM_TEXT_LIMIT) return "SUMMARY_TOO_LONG";
  if (/\u0000/u.test(summary)) return "SUMMARY_INVALID_ENCODING";
  if (/<\/?(?:system|assistant|tool)>/iu.test(summary)) {
    return "SUMMARY_PROTOCOL_LEAKAGE";
  }
  return undefined;
}

async function sendTelegramMessage(
  token: string,
  chatId: string,
  text: string,
): Promise<number> {
  const response = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    },
  );
  const payload: unknown = await response.json();
  if (!response.ok) {
    const retryAfter = telegramRetryAfter(payload);
    throw new DeliveryError(
      `TELEGRAM_HTTP_${response.status}`,
      response.status === 429 || response.status >= 500,
      retryAfter,
    );
  }
  const messageId = telegramMessageId(payload);
  if (messageId === undefined) {
    throw new DeliveryError("TELEGRAM_MALFORMED_RESPONSE", true);
  }
  return messageId;
}

class DeliveryError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    readonly retryAfterSeconds = DEFAULT_RETRY_SECONDS,
  ) {
    super(code);
  }
}

function classifyFailure(error: unknown): {
  readonly code: string;
  readonly retryable: boolean;
  readonly retryAfterSeconds: number;
} {
  if (error instanceof DeliveryError) return error;
  if (error instanceof OllamaError) {
    return {
      code: `MODEL_HTTP_${error.status ?? "UNKNOWN"}`,
      retryable: error.status === 429 || (error.status ?? 500) >= 500,
      retryAfterSeconds: DEFAULT_RETRY_SECONDS,
    };
  }
  return {
    code: error instanceof Error ? error.name : "UNKNOWN_ERROR",
    retryable: true,
    retryAfterSeconds: DEFAULT_RETRY_SECONDS,
  };
}

function telegramMessageId(payload: unknown): number | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const result = (payload as { result?: unknown }).result;
  if (typeof result !== "object" || result === null) return undefined;
  const value = (result as { message_id?: unknown }).message_id;
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : undefined;
}

function telegramRetryAfter(payload: unknown): number {
  if (typeof payload !== "object" || payload === null)
    return DEFAULT_RETRY_SECONDS;
  const parameters = (payload as { parameters?: unknown }).parameters;
  if (typeof parameters !== "object" || parameters === null) {
    return DEFAULT_RETRY_SECONDS;
  }
  const value = (parameters as { retry_after?: unknown }).retry_after;
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : DEFAULT_RETRY_SECONDS;
}

export default {} satisfies ExportedHandler<Env>;

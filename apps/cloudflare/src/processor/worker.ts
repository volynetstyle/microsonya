import { tracing, WorkerEntrypoint } from "cloudflare:workers";
import {
  MessagesRepo,
  SummariesRepo,
  dataEncryptionFromBase64,
  openWorkerDb,
  type PersistedSummaryAttempt,
} from "@microsonya/db";
import { OllamaClient, OllamaError } from "@microsonya/model";
import type { ProcessSummaryRunResult } from "@microsonya/contracts";
import {
  asSummaryId,
  asTimestampMs,
  type DeferReason,
  type SummaryId,
} from "@microsonya/shared";
import { createSummarizer, presentDisposition } from "@microsonya/summarize";
import { EMPTY_SUMMARY_MESSAGE, classifyUnknownFailure } from "./policy.js";
import { logTelemetry, recordTelemetryMetric } from "../observability.js";
import { createProcessorTelemetry } from "./telemetry.js";

const DEFAULT_RETRY_SECONDS = 30;
const MAX_ATTEMPTS = 4;
const MAX_DELIVERY_ATTEMPTS = 4;
const TELEGRAM_TEXT_LIMIT = 4_096;
const LEASE_HEARTBEAT_MS = 30_000;

type Services = {
  readonly messages: MessagesRepo;
  readonly summaries: SummariesRepo;
  readonly ollama: OllamaClient;
};

type DeliveryClaim = {
  readonly runId: SummaryId;
  readonly leaseToken: string;
  readonly deliveryAttempt: number;
  readonly chatId: string;
  readonly summary?: string;
};

type ProcessingPhase =
  | "services.bootstrap"
  | "outcome.lookup"
  | "summary.generate"
  | "summary.present"
  | "summary.validate"
  | "summary.persist"
  | "delivery.claim";

async function withServices<T>(
  env: Env,
  operation: (services: Services) => Promise<T>,
): Promise<T> {
  const client = await openWorkerDb(env.HYPERDRIVE.connectionString);
  const encryption = dataEncryptionFromBase64(
    env.MICROSONYA_DATA_ENCRYPTION_KEY,
  );
  try {
    return await operation({
      messages: new MessagesRepo(client.db, encryption),
      summaries: new SummariesRepo(client.db, encryption),
      ollama: new OllamaClient({
        baseUrl: env.OLLAMA_BASE_URL,
        apiKey: env.OLLAMA_API_KEY,
      }),
    });
  } finally {
    await client.close();
  }
}

function presentPersistedAttempt(attempt: PersistedSummaryAttempt): string {
  if (attempt.summaryText !== undefined) return attempt.summaryText;
  if (attempt.status === "empty") {
    return EMPTY_SUMMARY_MESSAGE;
  }
  if (attempt.status === "deferred" && attempt.action?.startsWith("DEFER_")) {
    return presentDisposition({
      kind: "deferred",
      reason: attempt.action as DeferReason,
    });
  }
  throw new TypeError("Persisted summary attempt has no presentation.");
}

export function presentGeneratedDisposition(
  disposition:
    | Awaited<ReturnType<ReturnType<typeof createSummarizer>["process"]>>
    | string,
): string {
  if (typeof disposition === "string") return disposition;
  return disposition === null
    ? EMPTY_SUMMARY_MESSAGE
    : presentDisposition(disposition);
}

export class SummaryProcessorEntrypoint extends WorkerEntrypoint<Env> {
  async process(runId: SummaryId): Promise<ProcessSummaryRunResult> {
    return tracing.enterSpan("summary.process", async (span) => {
      const startedAt = Date.now();
      span.setAttribute("microsonya.run_id", runId);
      span.setAttribute(
        "microsonya.processor_version",
        this.env.PROCESSOR_VERSION,
      );
      const result = await this.processRun(runId);
      span.setAttribute("microsonya.status", result.disposition);
      const durationMs = Date.now() - startedAt;
      const outcome =
        result.disposition === "permanent-failure"
          ? "failed_permanent"
          : result.disposition;
      recordTelemetryMetric(
        this.env.ANALYTICS,
        "processor",
        "summary.process",
        outcome,
        durationMs,
      );
      logTelemetry("info", "processor", "summary.process.finish", {
        runId,
        disposition: result.disposition,
        totalMs: durationMs,
      });
      return result;
    });
  }

  private async processRun(runId: SummaryId): Promise<ProcessSummaryRunResult> {
    const status = await this.env.SUMMARY_RUNS.status(runId);
    if (status === "missing") return { disposition: "permanent-failure" };
    if (status === "completed" || status === "failed_permanent") {
      return {
        disposition: status === "completed" ? "completed" : "permanent-failure",
      };
    }
    const delivery = await this.env.SUMMARY_RUNS.claimDelivery(runId);
    if (delivery !== undefined) return this.deliver(delivery);

    const claimed = await tracing.enterSpan("summary_run.claim", (span) => {
      span.setAttribute("microsonya.run_id", runId);
      return this.env.SUMMARY_RUNS.claimProcessing(
        runId,
        this.env.PROCESSOR_VERSION,
      );
    });
    if (claimed === undefined)
      return { disposition: "retry", retryAfterSeconds: 5 };
    if (claimed.attempt > MAX_ATTEMPTS) {
      const errorCode = "PROCESSING_ATTEMPTS_EXHAUSTED";
      const failed = await this.env.SUMMARY_RUNS.markFailed(
        runId,
        claimed.leaseToken,
        "processing",
        errorCode,
      );
      if (failed) logTerminalFailure(runId, "processing", errorCode);
      return failed
        ? { disposition: "permanent-failure" }
        : { disposition: "retry", retryAfterSeconds: 5 };
    }

    let phase: ProcessingPhase = "services.bootstrap";
    try {
      const disposition = await this.withProcessingLeaseHeartbeat(
        runId,
        claimed.leaseToken,
        () =>
          withServices(this.env, async (deps) => {
            phase = "outcome.lookup";
            const persisted =
              await deps.summaries.findOrchestratedOutcome(runId);
            if (persisted !== undefined)
              return presentPersistedAttempt(persisted);
            const attemptId = asSummaryId(
              `${runId}:attempt:${claimed.attempt}`,
            );
            const summarizer = createSummarizer({
              messages: deps.messages,
              summaries: {
                findLastRun: (chatId) =>
                  deps.summaries.findLastCheckpoint(chatId),
                saveRun: (run) => deps.summaries.saveRun(run),
                saveAttempt: (attempt) =>
                  deps.summaries.saveAttempt(attempt, {
                    runId,
                    attempt: claimed.attempt,
                    leaseToken: claimed.leaseToken,
                    acceptedAt: asTimestampMs(Date.now()),
                  }),
              },
              ollama: deps.ollama,
              createSummaryId: () => attemptId,
              now: () => asTimestampMs(Date.now()),
              telemetry: createProcessorTelemetry(this.env.ANALYTICS, runId),
            });
            phase = "summary.generate";
            return tracing.enterSpan("summary.generate", (span) => {
              span.setAttribute("microsonya.run_id", runId);
              span.setAttribute("microsonya.attempt", claimed.attempt);
              span.setAttribute(
                "microsonya.command_mode",
                claimed.command.mode,
              );
              return summarizer.process(claimed.command);
            });
          }),
      );
      phase = "summary.present";
      const summary = presentGeneratedDisposition(disposition);
      phase = "summary.validate";
      const validationError = tracing.enterSpan("summary.validate", (span) => {
        span.setAttribute("microsonya.run_id", runId);
        return validateSummary(summary);
      });
      if (validationError !== undefined) {
        const failed = await this.env.SUMMARY_RUNS.markFailed(
          runId,
          claimed.leaseToken,
          "processing",
          validationError,
        );
        if (failed) logTerminalFailure(runId, "processing", validationError);
        return failed
          ? { disposition: "permanent-failure" }
          : { disposition: "retry", retryAfterSeconds: 5 };
      }
      phase = "summary.persist";
      const saved = await tracing.enterSpan("summary.persist", (span) => {
        span.setAttribute("microsonya.run_id", runId);
        span.setAttribute("microsonya.model", "configured-profile");
        span.setAttribute("microsonya.prompt_version", "summarize-package");
        return this.env.SUMMARY_RUNS.saveSummary(
          runId,
          claimed.leaseToken,
          summary,
          {
            model: "configured-profile",
            promptVersion: "summarize-package",
          },
        );
      });
      if (!saved) return { disposition: "retry", retryAfterSeconds: 5 };
      phase = "delivery.claim";
      const ready = await this.env.SUMMARY_RUNS.claimDelivery(runId);
      return ready === undefined
        ? { disposition: "retry", retryAfterSeconds: 5 }
        : this.deliver(ready);
    } catch (error) {
      return this.handleProcessingError(
        runId,
        claimed.leaseToken,
        claimed.attempt,
        error,
        phase,
      );
    }
  }

  private async deliver(
    claim: DeliveryClaim,
  ): Promise<ProcessSummaryRunResult> {
    return tracing.enterSpan("telegram.deliver", async (span) => {
      span.setAttribute("microsonya.run_id", claim.runId);
      span.setAttribute("microsonya.delivery_attempt", claim.deliveryAttempt);
      const result = await this.deliverInsideSpan(claim);
      span.setAttribute("microsonya.status", result.disposition);
      return result;
    });
  }

  private async deliverInsideSpan(
    claim: DeliveryClaim,
  ): Promise<ProcessSummaryRunResult> {
    const { runId, leaseToken, deliveryAttempt, summary } = claim;
    if (summary === undefined || deliveryAttempt > MAX_DELIVERY_ATTEMPTS) {
      const errorCode =
        summary === undefined
          ? "SUMMARY_MISSING"
          : "DELIVERY_ATTEMPTS_EXHAUSTED";
      const failed = await this.env.SUMMARY_RUNS.markFailed(
        runId,
        leaseToken,
        "delivering",
        errorCode,
      );
      if (failed) logTerminalFailure(runId, "delivering", errorCode);
      return failed
        ? { disposition: "permanent-failure" }
        : { disposition: "retry", retryAfterSeconds: 5 };
    }

    try {
      const messageId = await sendTelegramMessage(
        this.env.TELEGRAM_BOT_TOKEN,
        claim.chatId,
        summary,
      );
      const persisted = await this.env.SUMMARY_RUNS.markCompleted(
        runId,
        leaseToken,
        messageId,
      );
      return persisted
        ? { disposition: "completed" }
        : { disposition: "retry", retryAfterSeconds: 5 };
    } catch (error) {
      const failure = classifyFailure(error);
      if (!failure.retryable) {
        const failed = await this.env.SUMMARY_RUNS.markFailed(
          runId,
          leaseToken,
          "delivering",
          failure.code,
        );
        if (failed) logTerminalFailure(runId, "delivering", failure.code);
        return failed
          ? { disposition: "permanent-failure" }
          : { disposition: "retry", retryAfterSeconds: 5 };
      }
      const retrying = await this.env.SUMMARY_RUNS.markRetry(
        runId,
        leaseToken,
        "delivering",
        failure.code,
        failure.retryAfterSeconds,
      );
      return retrying
        ? {
            disposition: "retry",
            retryAfterSeconds: failure.retryAfterSeconds,
          }
        : { disposition: "retry", retryAfterSeconds: 5 };
    }
  }

  private async handleProcessingError(
    runId: SummaryId,
    leaseToken: string,
    attempt: number,
    error: unknown,
    phase: ProcessingPhase,
  ): Promise<ProcessSummaryRunResult> {
    const failure = classifyFailure(error);
    if (!failure.retryable || attempt >= MAX_ATTEMPTS) {
      const failed = await this.env.SUMMARY_RUNS.markFailed(
        runId,
        leaseToken,
        "processing",
        failure.code,
      );
      if (failed) logTerminalFailure(runId, "processing", failure.code, phase);
      return failed
        ? { disposition: "permanent-failure" }
        : { disposition: "retry", retryAfterSeconds: 5 };
    }
    const retrying = await this.env.SUMMARY_RUNS.markRetry(
      runId,
      leaseToken,
      "processing",
      failure.code,
      failure.retryAfterSeconds,
    );
    return retrying
      ? {
          disposition: "retry",
          retryAfterSeconds: failure.retryAfterSeconds,
        }
      : { disposition: "retry", retryAfterSeconds: 5 };
  }

  private async withProcessingLeaseHeartbeat<T>(
    runId: SummaryId,
    leaseToken: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    let renewal = Promise.resolve(true);
    let leaseLost = false;
    const timer = setInterval(() => {
      renewal = renewal.then(async (previous) => {
        if (!previous) return false;
        const renewed = await this.env.SUMMARY_RUNS.renewLease(
          runId,
          leaseToken,
          "processing",
        );
        if (!renewed) leaseLost = true;
        return renewed;
      });
    }, LEASE_HEARTBEAT_MS);
    try {
      const result = await operation();
      await renewal;
      const renewed = await this.env.SUMMARY_RUNS.renewLease(
        runId,
        leaseToken,
        "processing",
      );
      if (leaseLost || !renewed) throw new LeaseLostError();
      return result;
    } finally {
      clearInterval(timer);
      await renewal;
    }
  }
}

function logTerminalFailure(
  runId: SummaryId,
  stage: "processing" | "delivering",
  errorCode: string,
  phase?: ProcessingPhase,
): void {
  logTelemetry("error", "processor", "summary.process.failed", {
    runId,
    stage,
    errorCode,
    ...(phase === undefined ? {} : { phase }),
  });
}

class LeaseLostError extends Error {
  constructor() {
    super("Processing lease was lost.");
    this.name = "LeaseLostError";
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

export function classifyFailure(error: unknown): {
  readonly code: string;
  readonly retryable: boolean;
  readonly retryAfterSeconds: number;
} {
  if (error instanceof DeliveryError) return error;
  if (error instanceof LeaseLostError) {
    return {
      code: error.name,
      retryable: true,
      retryAfterSeconds: 5,
    };
  }
  if (error instanceof OllamaError) {
    return {
      code: `MODEL_HTTP_${error.status ?? "UNKNOWN"}`,
      retryable: error.status === 429 || (error.status ?? 500) >= 500,
      retryAfterSeconds: DEFAULT_RETRY_SECONDS,
    };
  }
  if (error instanceof TypeError) {
    const code = KNOWN_TYPE_ERROR_CODES[error.message];
    if (code !== undefined) {
      return {
        code,
        retryable: false,
        retryAfterSeconds: DEFAULT_RETRY_SECONDS,
      };
    }
  }
  return classifyUnknownFailure(error);
}

const KNOWN_TYPE_ERROR_CODES: Readonly<Record<string, string>> = Object.freeze({
  "Summary ledger encryption key must be 32 bytes.":
    "CONFIG_DATA_ENCRYPTION_KEY_INVALID",
  "Invalid summary ledger ciphertext envelope.":
    "DATA_CIPHERTEXT_ENVELOPE_INVALID",
  "Persisted summary attempt has no presentation.":
    "PERSISTED_ATTEMPT_UNPRESENTABLE",
  "Unsupported PostgreSQL bytea driver value.":
    "DATA_BYTEA_DRIVER_VALUE_UNSUPPORTED",
  "Terminal summary text is missing ciphertext.":
    "LEGACY_SUMMARY_PRESENTATION_MISSING",
});

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

// The processor is invoked through its Service Binding entrypoint. Cloudflare
// still requires a module Worker to register an event handler at deployment;
// reject every public HTTP request rather than exposing a second transport.
export default {
  fetch(): Response {
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

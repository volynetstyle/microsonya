import { tracing } from "cloudflare:workers";
import {
  MessageHistoryRepository,
  SummaryAttemptRepository,
} from "@microsonya/db";
import { OllamaClient } from "@microsonya/model";
import type { ProcessSummaryRunResult } from "@microsonya/contracts";
import { asSummaryId, asTimestampMs, type SummaryId } from "@microsonya/shared";
import {
  createSummaryWorkflow,
  AttemptCommitConflict,
  GROUP_PROGRESSIVE_POLICY,
  PRIVATE_PROGRESSIVE_POLICY,
  ProgressiveSummarySession,
} from "@microsonya/summarize";
import {
  TelegramEditableMessageTransport,
  TelegramPrivateDraftTransport,
} from "@microsonya/telegram";
import { EMPTY_SUMMARY_MESSAGE } from "./policy.js";
import { logTelemetry, recordTelemetryMetric } from "../observability.js";
import { createProcessorTelemetry } from "./telemetry.js";
import { withWorkerDatabase } from "../runtime/worker-db.js";
import { validateTelegramPayload } from "./presentation/validate-telegram-payload.js";
import {
  presentAcceptedOutcome,
  presentGeneratedDisposition,
} from "./recover-accepted-outcome.js";
import { classifyFailure, LeaseLostError } from "./failure-policy.js";
import {
  createTelegramApi,
  DeliveryError,
  progressiveMessageId,
  sendTelegramMessage,
} from "./delivery/telegram-delivery.js";
import { withProcessingLeaseHeartbeat } from "./processing-lease-heartbeat.js";

const MAX_ATTEMPTS = 4;
const MAX_DELIVERY_ATTEMPTS = 4;

type Services = {
  readonly messages: MessageHistoryRepository;
  readonly summaryAttempts: SummaryAttemptRepository;
  readonly ollama: OllamaClient;
};

type DeliveryClaim = {
  readonly runId: SummaryId;
  readonly leaseToken: string;
  readonly deliveryAttempt: number;
  readonly chatId: string;
  readonly messageThreadId?: number;
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
  return withWorkerDatabase(env, (db, encryption) =>
    operation({
      messages: new MessageHistoryRepository(db, encryption),
      summaryAttempts: new SummaryAttemptRepository(db, encryption),
      ollama: new OllamaClient({
        baseUrl: env.OLLAMA_BASE_URL,
        apiKey: env.OLLAMA_API_KEY,
      }),
    }),
  );
}

export class SummaryExecutionProcessor {
  constructor(private readonly env: Env) {}

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
    const work = await tracing.enterSpan("summary_run.claim", (span) => {
      span.setAttribute("microsonya.run_id", runId);
      return this.env.SUMMARY_RUNS.claimWork(runId, this.env.PROCESSOR_VERSION);
    });
    if (work.kind === "missing" || work.kind === "failed_permanent") {
      return { disposition: "permanent-failure" };
    }
    if (work.kind === "completed") return { disposition: "completed" };
    if (work.kind === "delivery") return this.deliver(work.claim);
    if (work.kind === "pending") {
      return { disposition: "retry", retryAfterSeconds: 5 };
    }
    const claimed = work.claim;
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
    let progressiveSession: ProgressiveSummarySession | undefined;
    let progressiveTransport:
      | TelegramPrivateDraftTransport
      | TelegramEditableMessageTransport
      | undefined;
    try {
      const disposition = await withProcessingLeaseHeartbeat(
        () =>
          this.env.SUMMARY_RUNS.renewLease(
            runId,
            claimed.leaseToken,
            "processing",
          ),
        () =>
          withServices(this.env, async (deps) => {
            phase = "outcome.lookup";
            const acceptedOutcome =
              await deps.summaryAttempts.findAcceptedOutcomeByExecutionId(
                runId,
              );
            if (acceptedOutcome !== undefined)
              return presentAcceptedOutcome(acceptedOutcome);
            const attemptId = asSummaryId(
              `${runId}:attempt:${claimed.attempt}`,
            );
            const telegram = createTelegramApi(this.env.TELEGRAM_BOT_TOKEN);
            const isPrivate = !claimed.command.chatId.startsWith("-");
            progressiveTransport = isPrivate
              ? new TelegramPrivateDraftTransport(
                  telegram,
                  claimed.command.chatId,
                  claimed.command.commandMessageId,
                )
              : new TelegramEditableMessageTransport(telegram, {
                  chatId: claimed.command.chatId,
                  commandMessageId: claimed.command.commandMessageId,
                  ...(claimed.command.messageThreadId === undefined
                    ? {}
                    : { messageThreadId: claimed.command.messageThreadId }),
                });
            progressiveSession = new ProgressiveSummarySession(
              progressiveTransport,
              undefined,
              isPrivate ? PRIVATE_PROGRESSIVE_POLICY : GROUP_PROGRESSIVE_POLICY,
            );
            const summarizer = createSummaryWorkflow({
              messages: deps.messages,
              summaries: {
                findLatestConsumptionBoundary: (chatId) =>
                  deps.summaryAttempts.findLatestConsumptionBoundary(chatId),
                recordAcceptedOutcome: (outcome) =>
                  deps.summaryAttempts.recordAcceptedOutcome(outcome),
                recordAttempt: (attempt) =>
                  deps.summaryAttempts.recordAttempt(attempt, {
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
              progressive: progressiveSession,
            });
            phase = "summary.generate";
            return tracing.enterSpan("summary.generate", (span) => {
              span.setAttribute("microsonya.run_id", runId);
              span.setAttribute("microsonya.attempt", claimed.attempt);
              span.setAttribute(
                "microsonya.command_mode",
                claimed.command.mode,
              );
              return summarizer
                .process(claimed.command)
                .catch(async (error: unknown) => {
                  if (error instanceof AttemptCommitConflict) {
                    if (
                      error.result.status === "alreadyCommitted" &&
                      error.result.outcome !== undefined
                    ) {
                      await progressiveSession?.fail(error);
                      progressiveSession = undefined;
                      progressiveTransport = undefined;
                      return presentAcceptedOutcome(error.result.outcome);
                    }
                    throw new LeaseLostError();
                  }
                  throw error;
                });
            });
          }),
      );
      phase = "summary.present";
      const summary = presentGeneratedDisposition(disposition);
      phase = "summary.validate";
      const validationError = tracing.enterSpan("summary.validate", (span) => {
        span.setAttribute("microsonya.run_id", runId);
        return validateTelegramPayload(summary);
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
        return this.env.SUMMARY_RUNS.storeDeliveryPayload(
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
      if (ready === undefined) {
        return { disposition: "retry", retryAfterSeconds: 5 };
      }
      if (
        progressiveSession?.state === "finalizing" &&
        progressiveTransport !== undefined
      ) {
        try {
          await progressiveSession.commit();
          const messageId = progressiveMessageId(progressiveTransport);
          if (messageId === undefined) {
            throw new DeliveryError("TELEGRAM_MALFORMED_RESPONSE", true);
          }
          const completed = await this.env.SUMMARY_RUNS.markCompleted(
            runId,
            ready.leaseToken,
            messageId,
          );
          return completed
            ? { disposition: "completed" }
            : { disposition: "retry", retryAfterSeconds: 5 };
        } catch (error) {
          return this.handleClaimedDeliveryError(ready, error);
        }
      }
      return this.deliver(ready);
    } catch (error) {
      if (
        progressiveSession !== undefined &&
        progressiveSession.state !== "completed" &&
        progressiveSession.state !== "failed"
      ) {
        try {
          await progressiveSession.fail(error);
        } catch (presentationError) {
          logTelemetry("warn", "processor", "summary.progressive.fail", {
            runId,
            errorName:
              presentationError instanceof Error
                ? presentationError.name
                : "UNKNOWN_ERROR",
          });
        }
      }
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
        claim.messageThreadId,
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

  private async handleClaimedDeliveryError(
    claim: DeliveryClaim,
    error: unknown,
  ): Promise<ProcessSummaryRunResult> {
    const failure = classifyFailure(error);
    logTelemetry(
      failure.retryable ? "warn" : "error",
      "processor",
      "summary.delivery.failed",
      {
        runId: claim.runId,
        errorCode: failure.code,
        disposition: failure.retryable ? "retry" : "permanent-failure",
      },
    );
    if (!failure.retryable) {
      const failed = await this.env.SUMMARY_RUNS.markFailed(
        claim.runId,
        claim.leaseToken,
        "delivering",
        failure.code,
      );
      return failed
        ? { disposition: "permanent-failure" }
        : { disposition: "retry", retryAfterSeconds: 5 };
    }
    const retrying = await this.env.SUMMARY_RUNS.markRetry(
      claim.runId,
      claim.leaseToken,
      "delivering",
      failure.code,
      failure.retryAfterSeconds,
    );
    return retrying
      ? { disposition: "retry", retryAfterSeconds: failure.retryAfterSeconds }
      : { disposition: "retry", retryAfterSeconds: 5 };
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

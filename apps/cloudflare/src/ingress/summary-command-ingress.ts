import type {
  CreateSummaryRunRequest,
  SummaryJob,
} from "@microsonya/contracts";
import type { SummaryCommand } from "@microsonya/shared";
import { tracing } from "cloudflare:workers";
import { logTelemetry, recordTelemetryMetric } from "../observability.js";

type SummaryCommandEnv = Pick<Env, "SUMMARY_RUNS" | "ANALYTICS"> & {
  readonly SUMMARY_JOBS: Queue<SummaryJob>;
};

export async function acceptSummaryCommand(
  env: SummaryCommandEnv,
  command: SummaryCommand,
  context: ExecutionContext,
  startedAt: number,
): Promise<void> {
  const request: CreateSummaryRunRequest = {
    idempotencyKey: `telegram:${command.chatId}:${command.commandMessageId}`,
    command,
  };
  const run = await tracing.enterSpan("summary_run.create", (span) => {
    span.setAttribute("microsonya.command_mode", command.mode);
    return env.SUMMARY_RUNS.create(request);
  });
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
}

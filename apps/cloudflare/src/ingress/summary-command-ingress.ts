import type {
  CreateSummaryRunRequest,
  SummaryJob,
} from "@microsonya/contracts";
import type { SummaryCommand } from "@microsonya/shared";
import { tracing } from "cloudflare:workers";
import {
  createSummaryCommandObservability,
  type SummaryCommandObservability,
} from "./summary-command-observability.js";

type SummaryCommandEnv = Pick<Env, "SUMMARY_RUNS" | "ANALYTICS"> & {
  readonly SUMMARY_JOBS: Queue<SummaryJob>;
};

export async function acceptSummaryCommand(
  env: SummaryCommandEnv,
  command: SummaryCommand,
  context: ExecutionContext,
  startedAt: number,
): Promise<void> {
  return tracing.enterSpan("summary.command.accept", (span) => {
    span.setAttribute("microsonya.command_mode", command.mode);
    return acceptSummaryCommandCore(env, command, context, startedAt);
  });
}

async function acceptSummaryCommandCore(
  env: SummaryCommandEnv,
  command: SummaryCommand,
  context: ExecutionContext,
  startedAt: number,
): Promise<void> {
  const request: CreateSummaryRunRequest = {
    idempotencyKey: `telegram:${command.chatId}:${command.commandMessageId}`,
    command,
  };
  const observability = createSummaryCommandObservability(env.ANALYTICS);
  const run = await env.SUMMARY_RUNS.create(request);

  await env.SUMMARY_JOBS.send({ runId: run.runId } satisfies SummaryJob);

  context.waitUntil(markSummaryRunQueued(env, run.runId, observability));

  observability.runAccepted({
    runId: run.runId,
    disposition: "created",
    durationMs: Date.now() - startedAt,
  });
}

async function markSummaryRunQueued(
  env: SummaryCommandEnv,
  runId: string,
  observability: SummaryCommandObservability,
): Promise<void> {
  try {
    await env.SUMMARY_RUNS.markQueued(runId);
  } catch (error: unknown) {
    observability.markQueuedFailed({ runId, error });
  }
}

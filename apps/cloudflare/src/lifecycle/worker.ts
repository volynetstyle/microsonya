import { WorkerEntrypoint } from "cloudflare:workers";
import {
  SummaryLifecycleRepo,
  dataEncryptionFromBase64,
  openWorkerDb,
} from "@microsonya/db";
import { asSummaryId, asTimestampMs, type SummaryId } from "@microsonya/shared";
import type {
  CreateSummaryRunRequest,
  CreateSummaryRunResponse,
  SummaryJob,
} from "@microsonya/contracts";
import {
  decideReconciliation,
  type SummaryRunLifecycleStatus,
} from "@microsonya/run-lifecycle";

const STALE_AFTER_MS = 5 * 60_000;
const DEFAULT_LEASE_MS = 2 * 60_000;

async function withRepository<T>(
  env: Env,
  operation: (repository: SummaryLifecycleRepo) => Promise<T>,
): Promise<T> {
  const client = await openWorkerDb(env.HYPERDRIVE.connectionString);
  try {
    return await operation(
      new SummaryLifecycleRepo(
        client.db,
        dataEncryptionFromBase64(env.MICROSONYA_DATA_ENCRYPTION_KEY),
      ),
    );
  } finally {
    await client.close();
  }
}

export class SummaryRunsEntrypoint extends WorkerEntrypoint<Env> {
  async create(
    request: CreateSummaryRunRequest,
  ): Promise<CreateSummaryRunResponse> {
    const run = await withRepository(this.env, (repository) =>
      repository.create(request, asTimestampMs(Date.now())),
    );
    return { runId: run.id };
  }

  async markQueued(runId: SummaryId): Promise<boolean> {
    return withRepository(this.env, (repository) =>
      repository.transition(
        runId,
        "created",
        "queued",
        asTimestampMs(Date.now()),
      ),
    );
  }

  async touch(
    runId: SummaryId,
    status: "queued" | "summary_ready",
  ): Promise<boolean> {
    return withRepository(this.env, (repository) =>
      repository.touch(runId, status, asTimestampMs(Date.now())),
    );
  }

  async status(
    runId: SummaryId,
  ): Promise<"missing" | "pending" | "completed" | "failed_permanent"> {
    const run = await withRepository(this.env, (repository) =>
      repository.get(runId),
    );
    if (run === undefined) return "missing";
    if (run.status === "completed" || run.status === "failed_permanent") {
      return run.status;
    }
    return "pending";
  }

  async claimProcessing(runId: SummaryId, processorVersion: string) {
    return withRepository(this.env, (repository) =>
      repository.claimProcessing(
        runId,
        asTimestampMs(Date.now()),
        DEFAULT_LEASE_MS,
        processorVersion,
      ),
    );
  }

  async renewLease(
    runId: SummaryId,
    leaseToken: string,
    stage: "processing" | "delivering",
  ): Promise<boolean> {
    return withRepository(this.env, (repository) =>
      repository.renewLease(
        runId,
        leaseToken,
        stage,
        asTimestampMs(Date.now()),
        DEFAULT_LEASE_MS,
      ),
    );
  }

  async saveSummary(
    runId: SummaryId,
    leaseToken: string,
    summary: string,
    metadata: { readonly model?: string; readonly promptVersion?: string },
  ): Promise<boolean> {
    return withRepository(this.env, (repository) =>
      repository.saveSummary(
        runId,
        leaseToken,
        summary,
        asTimestampMs(Date.now()),
        metadata,
      ),
    );
  }

  async claimDelivery(runId: SummaryId) {
    return withRepository(this.env, async (repository) => {
      const claim = await repository.claimDelivery(
        runId,
        asTimestampMs(Date.now()),
        DEFAULT_LEASE_MS,
      );
      return claim === undefined
        ? undefined
        : {
            runId: claim.id,
            chatId: claim.command.chatId,
            summary: claim.summary,
            deliveryAttempt: claim.deliveryAttempt,
            leaseToken: claim.leaseToken,
          };
    });
  }

  async markCompleted(
    runId: SummaryId,
    leaseToken: string,
    telegramMessageId: number,
  ): Promise<boolean> {
    return withRepository(this.env, (repository) =>
      repository.markCompleted(
        runId,
        leaseToken,
        telegramMessageId,
        asTimestampMs(Date.now()),
      ),
    );
  }

  async markRetry(
    runId: SummaryId,
    leaseToken: string,
    from: "processing" | "delivering",
    errorCode: string,
    retryAfterSeconds: number,
  ): Promise<boolean> {
    const now = asTimestampMs(Date.now());
    return withRepository(this.env, (repository) =>
      repository.markRetry(
        runId,
        leaseToken,
        from,
        errorCode,
        now,
        asTimestampMs(now + retryAfterSeconds * 1_000),
      ),
    );
  }

  async markFailed(
    runId: SummaryId,
    leaseToken: string,
    from: "processing" | "delivering",
    errorCode: string,
  ): Promise<boolean> {
    return withRepository(this.env, (repository) =>
      repository.markFailed(
        runId,
        leaseToken,
        from,
        errorCode,
        asTimestampMs(Date.now()),
      ),
    );
  }

  async health() {
    const now = asTimestampMs(Date.now());
    return withRepository(this.env, (repository) =>
      repository.health(asTimestampMs(now - STALE_AFTER_MS), now),
    );
  }
}

export default {
  async scheduled(_controller, env): Promise<void> {
    const now = asTimestampMs(Date.now());
    await withRepository(env, async (repository) => {
      const stale = await repository.listStale(
        asTimestampMs(now - STALE_AFTER_MS),
        now,
      );
      const health = await repository.health(
        asTimestampMs(now - STALE_AFTER_MS),
        now,
      );
      env.ANALYTICS.writeDataPoint({
        indexes: ["production-health"],
        blobs: ["lifecycle.health"],
        doubles: [
          health.stuckRuns,
          health.deliveryStuck,
          health.retryOverdue,
          health.permanentFailures,
        ],
      });

      for (const run of stale) {
        const action = decideReconciliation(
          run,
          asTimestampMs(now - STALE_AFTER_MS),
          now,
        );
        if (action === "none") continue;
        try {
          await env.SUMMARY_JOBS.send({ runId: run.id } satisfies SummaryJob);
        } catch (error) {
          console.error("summary.reconcile.enqueue_error", {
            runId: run.id,
            errorName: error instanceof Error ? error.name : "UNKNOWN_ERROR",
          });
          continue;
        }
        if (action === "enqueue-created") {
          await repository.transition(run.id, "created", "queued", now);
        } else if (action === "reenqueue") {
          if (run.status === "queued" || run.status === "summary_ready") {
            await repository.touch(run.id, run.status, now);
          }
        } else if (action === "expire-lease-and-enqueue") {
          if (run.status === "processing" || run.status === "delivering") {
            const expired = await repository.expireLease(
              run.id,
              run.status,
              "LEASE_EXPIRED",
              now,
            );
            if (expired) {
              await repository.transition(run.id, "retry_wait", "queued", now);
            }
          }
        } else {
          await repository.transition(run.id, "retry_wait", "queued", now);
        }
      }
    });
  },
} satisfies ExportedHandler<Env, unknown>;

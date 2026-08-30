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
  type ReconciliationAction,
  type SummaryRunLifecycleStatus,
} from "@microsonya/run-lifecycle";
import { errorName, logTelemetry } from "../observability.js";

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
      recordLifecycleHealth(env.ANALYTICS, health);
      logTelemetry("info", "lifecycle", "summary.reconcile.scan", {
        staleCount: stale.length,
      });

      for (const run of stale) {
        const action = decideReconciliation(
          run,
          asTimestampMs(now - STALE_AFTER_MS),
          now,
        );
        if (action === "none") continue;

        try {
          // Claim the reconciliation action in PostgreSQL before enqueueing.
          // A concurrent cron invocation that loses the CAS must not publish
          // a duplicate job from the same stale snapshot.
          const prepared = await prepareRunForEnqueue(
            repository,
            run,
            action,
            now,
          );
          if (!prepared) continue;

          await env.SUMMARY_JOBS.send({ runId: run.id } satisfies SummaryJob);
        } catch (error) {
          // The run remains in a recoverable queued state. A later cron scan
          // will retry it if the Queue binding is temporarily unavailable.
          logTelemetry("error", "lifecycle", "summary.reconcile.error", {
            runId: run.id,
            errorName: errorName(error),
          });
        }
      }
    });
  },
} satisfies ExportedHandler<Env, unknown>;

async function prepareRunForEnqueue(
  repository: SummaryLifecycleRepo,
  run: {
    readonly id: SummaryId;
    readonly status: SummaryRunLifecycleStatus;
  },
  action: ReconciliationAction,
  now: ReturnType<typeof asTimestampMs>,
): Promise<boolean> {
  switch (action) {
    case "none":
      return false;
    case "enqueue-created":
      return repository.transition(run.id, "created", "queued", now);
    case "reenqueue":
      return run.status === "queued" || run.status === "summary_ready"
        ? repository.touch(run.id, run.status, now)
        : false;
    case "enqueue-retry":
      return repository.transition(run.id, "retry_wait", "queued", now);
    case "expire-lease-and-enqueue": {
      if (run.status !== "processing" && run.status !== "delivering") {
        return false;
      }
      const expired = await repository.expireLease(
        run.id,
        run.status,
        "LEASE_EXPIRED",
        now,
      );
      if (!expired) return false;
      return repository.transition(run.id, "retry_wait", "queued", now);
    }
  }
}

function recordLifecycleHealth(
  analytics: AnalyticsEngineDataset,
  health: {
    readonly stuckRuns: number;
    readonly deliveryStuck: number;
    readonly retryOverdue: number;
    readonly permanentFailures: number;
  },
): void {
  try {
    analytics.writeDataPoint({
      indexes: ["lifecycle:health"],
      blobs: ["lifecycle.health"],
      doubles: [
        health.stuckRuns,
        health.deliveryStuck,
        health.retryOverdue,
        health.permanentFailures,
      ],
    });
  } catch (error) {
    logTelemetry("warn", "lifecycle", "telemetry.metric_write_failed", {
      errorName: errorName(error),
    });
  }
}

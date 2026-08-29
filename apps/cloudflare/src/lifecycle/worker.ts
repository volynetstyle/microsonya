import { WorkerEntrypoint } from "cloudflare:workers";
import {
  SummaryLifecycleRepo,
  dataEncryptionFromBase64,
  openDb,
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

let cached:
  | { readonly connectionString: string; readonly repo: SummaryLifecycleRepo }
  | undefined;

function repository(env: Env): SummaryLifecycleRepo {
  if (cached?.connectionString === env.HYPERDRIVE.connectionString) {
    return cached.repo;
  }
  const client = openDb(env.HYPERDRIVE.connectionString);
  const repo = new SummaryLifecycleRepo(
    client.db,
    dataEncryptionFromBase64(env.MICROSONYA_DATA_ENCRYPTION_KEY),
  );
  cached = { connectionString: env.HYPERDRIVE.connectionString, repo };
  return repo;
}

export class SummaryRunsEntrypoint extends WorkerEntrypoint<Env> {
  async create(
    request: CreateSummaryRunRequest,
  ): Promise<CreateSummaryRunResponse> {
    const run = await repository(this.env).create(
      request,
      asTimestampMs(Date.now()),
    );
    return { runId: run.id };
  }

  async markQueued(runId: SummaryId): Promise<boolean> {
    return repository(this.env).transition(
      runId,
      "created",
      "queued",
      asTimestampMs(Date.now()),
    );
  }

  async touch(
    runId: SummaryId,
    status: "queued" | "summary_ready",
  ): Promise<boolean> {
    return repository(this.env).touch(runId, status, asTimestampMs(Date.now()));
  }

  async get(runId: SummaryId) {
    return repository(this.env).get(runId);
  }

  async claim(runId: SummaryId, processorVersion: string) {
    return repository(this.env).claim(
      runId,
      asTimestampMs(Date.now()),
      DEFAULT_LEASE_MS,
      processorVersion,
    );
  }

  async transition(
    runId: SummaryId,
    from: SummaryRunLifecycleStatus,
    to: SummaryRunLifecycleStatus,
  ): Promise<boolean> {
    return repository(this.env).transition(
      runId,
      from,
      to,
      asTimestampMs(Date.now()),
    );
  }

  async saveSummary(
    runId: SummaryId,
    summary: string,
    metadata: { readonly model?: string; readonly promptVersion?: string },
  ): Promise<boolean> {
    return repository(this.env).saveSummary(
      runId,
      summary,
      asTimestampMs(Date.now()),
      metadata,
    );
  }

  async beginDelivery(runId: SummaryId): Promise<boolean> {
    return repository(this.env).beginDelivery(
      runId,
      asTimestampMs(Date.now()),
      DEFAULT_LEASE_MS,
    );
  }

  async markCompleted(
    runId: SummaryId,
    telegramMessageId: number,
  ): Promise<boolean> {
    return repository(this.env).markCompleted(
      runId,
      telegramMessageId,
      asTimestampMs(Date.now()),
    );
  }

  async markRetry(
    runId: SummaryId,
    from: "processing" | "delivering",
    errorCode: string,
    retryAfterSeconds: number,
  ): Promise<boolean> {
    const now = asTimestampMs(Date.now());
    return repository(this.env).markRetry(
      runId,
      from,
      errorCode,
      now,
      asTimestampMs(now + retryAfterSeconds * 1_000),
    );
  }

  async markFailed(runId: SummaryId, errorCode: string): Promise<boolean> {
    return repository(this.env).markFailed(
      runId,
      errorCode,
      asTimestampMs(Date.now()),
    );
  }

  async health() {
    const now = asTimestampMs(Date.now());
    return repository(this.env).health(
      asTimestampMs(now - STALE_AFTER_MS),
      now,
    );
  }
}

export default {
  async scheduled(_controller, env): Promise<void> {
    const now = asTimestampMs(Date.now());
    const stale = await repository(env).listStale(
      asTimestampMs(now - STALE_AFTER_MS),
      now,
    );
    const health = await repository(env).health(
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
      if (action === "enqueue-created") {
        const queued = await repository(env).transition(
          run.id,
          "created",
          "queued",
          now,
        );
        if (!queued) continue;
      } else if (action === "reenqueue") {
        if (run.status !== "queued" && run.status !== "summary_ready") continue;
        const touched = await repository(env).touch(run.id, run.status, now);
        if (!touched) continue;
      } else if (action === "expire-lease-and-enqueue") {
        if (run.status !== "processing" && run.status !== "delivering") {
          continue;
        }
        const retrying = await repository(env).markRetry(
          run.id,
          run.status,
          "LEASE_EXPIRED",
          now,
          now,
        );
        if (!retrying) continue;
        const queued = await repository(env).transition(
          run.id,
          "retry_wait",
          "queued",
          now,
        );
        if (!queued) continue;
      } else {
        const queued = await repository(env).transition(
          run.id,
          "retry_wait",
          "queued",
          now,
        );
        if (!queued) continue;
      }
      await env.SUMMARY_JOBS.send({ runId: run.id } satisfies SummaryJob);
    }
  },
} satisfies ExportedHandler<Env, unknown>;

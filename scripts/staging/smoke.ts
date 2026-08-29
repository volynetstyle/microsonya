import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  printStagingTarget,
  requireStagingMutationApproval,
  stagingDatabaseTarget,
  withStagingClient,
} from "./database.js";

const target = stagingDatabaseTarget();
requireStagingMutationApproval();
printStagingTarget(target);

const verificationSql = await readFile(
  resolve(dirname(fileURLToPath(import.meta.url)), "verify-staging-schema.sql"),
  "utf8",
);

await withStagingClient(async (client) => {
  await client.query("begin");
  try {
    await client.query(verificationSql);
  } finally {
    await client.query("rollback");
  }

  // A pg.Client processes one query at a time; preserve that contract instead
  // of concurrently queuing catalog reads on the same connection.
  const constraints = await client.query<{ conname: string; contype: string }>(
    `select conname, contype
     from pg_constraint
     where conrelid = 'public.summary_run_lifecycle'::regclass
     order by conname`,
  );
  const indexes = await client.query<{ indexname: string }>(
    `select indexname
     from pg_indexes
     where schemaname = 'public'
       and tablename = 'summary_run_lifecycle'
     order by indexname`,
  );
  const sample = await client.query<{
    id: string;
    status: string;
    attempt: number;
    created_at: string;
    updated_at: string;
  }>(
    `select id, status, attempt, created_at::text, updated_at::text
     from summary_run_lifecycle
     order by created_at desc
     limit 1`,
  );

  const expectedChecks = [
    "summary_run_lifecycle_status_check",
    "summary_run_lifecycle_mode_check",
    "summary_run_lifecycle_attempt_check",
    "summary_run_lifecycle_count_check",
  ];
  const actualChecks = new Set(
    constraints.rows
      .filter(({ contype }) => contype === "c")
      .map(({ conname }) => conname),
  );
  const actualIndexes = new Set(indexes.rows.map(({ indexname }) => indexname));
  const missingChecks = expectedChecks.filter(
    (name) => !actualChecks.has(name),
  );

  if (missingChecks.length > 0) {
    throw new Error(`Missing lifecycle checks: ${missingChecks.join(", ")}.`);
  }
  if (!actualIndexes.has("idx_summary_run_lifecycle_idempotency")) {
    throw new Error("Missing UNIQUE(idempotency_key) lifecycle index.");
  }

  console.info(
    `Lifecycle constraints: ${[...actualChecks].sort().join(", ")}.`,
  );
  console.info("Lifecycle idempotency: UNIQUE(idempotency_key) index present.");
  console.info(
    sample.rows[0]
      ? `Lifecycle sample: ${JSON.stringify(sample.rows[0])}`
      : "Lifecycle sample: table is currently empty.",
  );
});

console.info(
  "Staging schema and constraint smoke test passed (all probe writes rolled back).",
);
console.info("SCHEMA = expected");

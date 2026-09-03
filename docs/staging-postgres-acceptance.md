# Staging PostgreSQL acceptance

This repository treats the staging PostgreSQL project as a real acceptance target, not as a loose copy of development. It is intentionally separate from production and has its own direct/pooler connection string, Worker bindings, Queue/DLQ, and Telegram test bot.

The commands below never read `DATABASE_URL` as a fallback. They require `STAGING_DATABASE_URL`, so a missing staging variable fails closed instead of silently touching the default database.

## One-time setup

Create a dedicated Supabase project for staging, then add its connection string only to the local secret store or CI environment. For local use, the staging commands automatically read `.env.staging` and then `.env.staging.local`; they intentionally do not read `.env`.

```powershell
@'
STAGING_DATABASE_URL=postgresql://...
MICROSONYA_STAGING_CONFIRM=microsonya-staging
'@ | Set-Content .env.staging
```

Alternatively, export the variables in the current shell. Do not commit either value; both staging file names are Git-ignored.

```powershell
$env:MICROSONYA_STAGING_CONFIRM = "microsonya-staging"
```

`STAGING_DATABASE_URL` may be a direct PostgreSQL URL or a Supabase pooler URL. The acceptance scripts print only host, port, database, and user; they never print passwords or query parameters.

## Acceptance sequence

First verify the exact target and its PostgreSQL reachability. This is read-only and can be used before the schema exists.

```powershell
pnpm db:staging:verify
```

Apply the repository's Drizzle migrations to the explicitly approved staging target:

```powershell
pnpm db:staging:plan
pnpm db:staging:migrate
```

`db:staging:plan` is read-only. It compares the repository migration journal with the count recorded by Drizzle and prints the repository entries that would be next. It is an operator review aid, not a substitute for a PostgreSQL migration dry-run: Drizzle applies real DDL only in `db:staging:migrate`.

Then run the schema smoke test:

```powershell
pnpm db:staging:smoke
```

Or run the complete protocol:

```powershell
pnpm db:staging:acceptance
```

Its final receipt is based on PostgreSQL catalog/state rather than a migration command exit code:

```text
MIGRATIONS = PASS
SCHEMA = expected
```

The smoke test verifies these properties against PostgreSQL itself:

- `summary_run_lifecycle` exists and exposes the idempotency unique index;
- PostgreSQL catalog contains the expected status, mode, attempt, and count check constraints;
- a duplicate `idempotency_key` produces `unique_violation`;
- invalid lifecycle status, mode, negative attempt, and invalid `count` mode each produce `check_violation`;
- every probe row is inside a transaction that is always rolled back.

It additionally prints one non-sensitive lifecycle sample (`id`, `status`, `attempt`, timestamps) when a row exists. It never prints encrypted chat IDs, summaries, or message content.

This makes the constraints physical database behavior, rather than assumptions in application tests.

## Worker pipeline acceptance

Run the multi-Worker production-build harness only after database acceptance passes:

```powershell
pnpm test:pipeline:staging
```

It loads only `.env.staging` and requires `STAGING_PIPELINE_DATABASE_URL`; during the transition it accepts the existing `STAGING_DATABASE_URL` as an explicit compatibility fallback. The harness injects that exact target as each Worker's programmatic Hyperdrive `localConnectionString`, so every local Worker connects to the database asserted by the test without a second process-global override.

The test sends an ordinary Telegram message before `/summary`, verifies that `messages` contains it, mocks both the model and Telegram delivery, and then verifies a completed `summary_run_lifecycle` record with persisted output and delivery metadata.

## What this gate deliberately does not do

It does not create a Supabase project, configure Hyperdrive, deploy Workers, or set Cloudflare/Supabase secrets. Those are external state changes and require explicitly scoped credentials and approval. Once the database acceptance is green, use its exact staging connection in the Worker staging configuration and run the existing real-pipeline test with `PIPELINE_DATABASE_URL` pointed at that same staging target.

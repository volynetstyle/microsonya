# Microsonya production-readiness gates

## Local release gate

```bash
pnpm release:gate
pnpm test:faults
```

These gates are hermetic. They cover TypeScript and generated Wrangler RPC
contracts, PostgreSQL constraints and concurrency, Workers Queue semantics,
reconciliation policy, processing/delivery lease recovery, and the WMA suite.

## Multi-Worker pipeline gate

`test:pipeline` deliberately requires a PostgreSQL wire endpoint because the
production Workers use Hyperdrive rather than an in-memory storage substitute.
Apply all migrations first. `PIPELINE_DATABASE_URL` must point to the same
dedicated test database as `localConnectionString` in both Worker configs.

```powershell
$env:PIPELINE_DATABASE_URL = "postgresql://microsonya:microsonya@localhost:5432/microsonya"
pnpm test:pipeline
```

The test uses Cloudflare's `createTestHarness()` with the three production
Wrangler configurations. It sends a Telegram webhook through the edge Worker,
crosses Service Bindings and Queue, mocks only Telegram's external HTTP API,
and polls `summary_run_lifecycle` for `completed` plus the persisted Telegram
message id.

Do not point this test at production. Use a dedicated local or CI database.

## Operational health

`SummaryRunsEntrypoint.health()` returns:

```text
stuckRuns
deliveryStuck
retryOverdue
permanentFailures
```

The scheduled reconciler writes the same values to Analytics Engine as the
`lifecycle.health` datapoint. Alert on any non-zero stuck, delivery-stuck, or
retry-overdue value. Treat permanent failures as an SLO rate rather than an
unqualified exception count.

Processor Analytics Engine datapoints use `PROCESSOR_VERSION` as their index,
store event/disposition/model/error/prompt version in blobs, and duration in
doubles. Custom spans use the common `microsonya.*` attributes and include:

```text
telegram.ingress
summary_run.create
summary.queue_message
summary.process
summary_run.claim
summary.generate
summary.validate
summary.persist
telegram.deliver
```

Configure OTLP destinations such as Sentry in the Cloudflare dashboard, then
add their destination names to `observability.logs.destinations` and
`observability.traces.destinations` in each Wrangler environment. Destination
credentials belong in Cloudflare, never in this repository.

## Cloud gate

Cloud production-readiness is established only after all of the following pass
in a dedicated staging environment:

```text
migrations
Hyperdrive connectivity
Service RPC
Queue and DLQ
scheduled reconciler
Telegram test bot E2E
trace and Analytics Engine visibility
stuckRuns = 0
deliveryStuck = 0
retryOverdue = 0
DLQ depth = 0
```

The Telegram `sendMessage` call has no application idempotency key. A crash
after Telegram accepts the message but before `markCompleted` remains a bounded,
documented duplicate-delivery risk.

## Deployment topology

Cloudflare edge is the single production Telegram webhook owner. Every update
is validated once; ordinary supported messages are persisted as encrypted
canonical `ChatMessage` records before command dispatch. `/summary` and other
slash commands are control input and never enter the semantic conversation
window. The Node/Telegraf app remains a local/rollback adapter during migration,
but must not have the production webhook while the Cloudflare edge is active.

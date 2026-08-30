# Microsonya Cloudflare edge app

Official Cloudflare Workers SDK adapter around the existing Microsonya domain.
Wrangler configuration is the source of truth for platform bindings and
`worker-configuration.d.ts` is generated; this app does not redeclare Workers
runtime types. The only local refinement is `Queue<SummaryJob>`, which preserves
the generated binding set while carrying Microsonya's queue message type.

```text
Telegram webhook
  -> edge Worker
  -> SUMMARY_RUNS.create({ idempotencyKey, command })
  -> Queue({ runId })
  -> SUMMARY_PROCESSOR.process(runId)
```

## Telegram Mini App hosting

`microsonya-wma` is a CSR Solid app hosted as Cloudflare Workers Static Assets.
Static navigations are served from the CDN; only `/api/wma/*` invokes the BFF
Worker. The browser never reaches the lifecycle, processor, Queue, or database
topology directly.

```sh
pnpm --filter @microsonya/cloudflare deploy:staging:wma
pnpm --filter @microsonya/cloudflare deploy:wma
```

Before the first deploy, configure `TELEGRAM_BOT_TOKEN` and the existing
`MICROSONYA_DATA_ENCRYPTION_KEY` as Worker secrets for each environment. Attach
the published Worker custom domain, then configure that HTTPS URL in BotFather
as the Mini App URL.

Microsonya-owned portable request/result types live in
`@microsonya/contracts`. Telegram command parsing lives in
`@microsonya/telegram` and consumes Bot API types from `@telegraf/types`.

## Generate platform types

```sh
pnpm --filter @microsonya/cloudflare types
pnpm --filter @microsonya/cloudflare types:check
```

Rerun generation after every binding, variable, compatibility date, or flag
change in `wrangler.jsonc`. `secrets.required` in `wrangler.jsonc` is the source
of truth for required secret names; `.dev.vars.example` is documentation only.

## Required Cloudflare resources

- Queue `microsonya-summary-runs`.
- Dead-letter Queue `microsonya-summary-runs-dlq`; exhausted jobs must remain
  inspectable instead of being discarded.
- Analytics Engine dataset `microsonya_runs` for non-blocking run outcome
  signals. PostgreSQL remains authoritative business state.
- Service `microsonya-summary-runs`, exporting `SummaryRunsEntrypoint` with
  idempotent `create()` semantics for `telegram:<chatId>:<commandMessageId>`.
- Service `microsonya-summary-processor`, exporting
  `SummaryProcessorEntrypoint` and making `process(runId)` plus Telegram delivery
  idempotent.

The service binding RPC stubs are inferred from the exported entrypoint classes
by Wrangler. No internal URLs, manual JSON serialization, or `Fetcher` wrappers
are involved.

Workers Logs and traces start at 100% sampling for the initial production
period. This is operational evidence only; it never substitutes for durable
`SummaryRun` lifecycle state.

For local development, copy `.dev.vars.example` to `.dev.vars`, replace the
placeholder, then run `pnpm --filter @microsonya/cloudflare dev`. For deployment,
store the same value as a Cloudflare secret:

```sh
pnpm --filter @microsonya/cloudflare exec wrangler secret put TELEGRAM_WEBHOOK_SECRET
```

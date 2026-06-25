# Microsonya

On-demand incremental chat summarization for Telegram groups.

Microsonya stores Telegram group messages, keeps compact summary state in Postgres, and answers `/summarize` commands through an OpenAI-compatible model provider such as OpenRouter.

## What Is Inside

```text
apps/
  telegram/bot/        Telegram adapter and command handling
packages/
  db/                  Drizzle schema, migrations, and repositories
  model-gateway/       OpenAI-compatible model client and fallback logic
  shared/              Shared types and errors
  summarize/           Window selection, segmentation, prompts, and summary runtime
```

The bot is deliberately thin. The summarization runtime owns the useful logic.

## Requirements

- Node.js 22 or newer
- pnpm 10.12.1 or newer
- PostgreSQL 16 or newer, or Docker for the bundled Postgres service
- Telegram bot token from `@BotFather`
- OpenAI-compatible API key, for example an OpenRouter token

## Quick Start With Docker

This is the easiest path for a fresh machine because Compose starts Postgres for you.

```bash
cp .env.docker.example .env
```

Edit `.env` and set:

- `TELEGRAM_BOT_TOKEN`
- `OPENROUTER_TOKEN` or `LLM_API_KEY`

Then start the database and bot:

```bash
pnpm install
pnpm docker:build
pnpm docker:up
pnpm db:migrate
pnpm docker:logs
```

`pnpm db:migrate` runs against `DATABASE_URL`. For the bundled Docker database, use this local URL in `.env` while running migrations from the host:

```env
DATABASE_URL=postgresql://microsonya:microsonya@localhost:5432/microsonya
```

The bot container itself can keep `DATABASE_URL` empty in `.env.docker.example`; `compose.yaml` points it at the internal `postgres` service automatically.

## Local Start

Use this when you already have Postgres running locally.

```bash
pnpm install
cp .env.example .env
```

Edit `.env` and set:

- `TELEGRAM_BOT_TOKEN`
- `DATABASE_URL`
- `OPENROUTER_TOKEN` or `LLM_API_KEY`

Prepare and run:

```bash
pnpm build
pnpm db:migrate
pnpm test
pnpm start
```

## Environment Variables

| Name | Required | Description |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | Yes | Token for the Telegram bot. |
| `DATABASE_URL` | Yes for local commands | Postgres connection string used by Drizzle and local bot runs. |
| `OPENROUTER_TOKEN` | Usually | OpenRouter API token. Used when `LLM_API_KEY` is not set. |
| `LLM_API_KEY` | Usually | Generic OpenAI-compatible API key. Takes precedence over `OPENROUTER_TOKEN`. |
| `LLM_BASE_URL` | No | OpenAI-compatible base URL. Defaults to `https://openrouter.ai/api/v1/`. |
| `LLM_MODEL` | No | Single model to use. If empty, the fallback list is used. |
| `LLM_MODELS` | No | Comma-separated fallback model list. |
| `LLM_QUARANTINE_MODELS` | No | Comma-separated models to remove from the fallback list. |
| `POSTGRES_DB` | Docker only | Database name for the Compose Postgres service. |
| `POSTGRES_USER` | Docker only | Database user for the Compose Postgres service. |
| `POSTGRES_PASSWORD` | Docker only | Database password for the Compose Postgres service. |
| `POSTGRES_PORT` | Docker only | Host port mapped to Postgres. Defaults to `5432`. |

To use a local Ollama or other OpenAI-compatible endpoint, change `LLM_BASE_URL`, `LLM_MODEL`, and `LLM_API_KEY` according to that provider.

## Telegram Commands

- `/summarize` summarizes messages after the last successful summary, within the last 12 hours, up to 500 messages.
- `/summarize today` summarizes text messages from the current local day.
- `/summarize 100` summarizes the last 100 text messages, clamped to 500.

## Development

```bash
pnpm build
pnpm typecheck
pnpm test
```

Database schema lives in `packages/db/src/schema.ts`. Generated migrations are stored in `packages/db/src/migrations`.

```bash
pnpm db:generate
pnpm db:migrate
```

Useful Docker commands:

```bash
pnpm docker:build
pnpm docker:up
pnpm docker:logs
```

## Deployment

The included `Dockerfile` builds the Telegram bot as the production target.

For a hosted Docker service, set at least:

- `TELEGRAM_BOT_TOKEN`
- `DATABASE_URL`
- `LLM_BASE_URL`
- `LLM_MODEL` or `LLM_MODELS`
- `LLM_API_KEY` or `OPENROUTER_TOKEN`

Run the Drizzle migrations against the production database before starting or releasing the bot.

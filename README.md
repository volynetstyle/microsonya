# Microsonya

On-demand incremental chat summarization for Telegram groups.

Microsonya stores Telegram group messages, keeps compact summary state in Postgres, and answers `/summarize` commands through an OpenAI-compatible model provider such as OpenRouter.

## What Is Inside

```text
apps/
  telegram/bot/        Telegram adapter and command handling
packages/
  db/                  Drizzle schema, migrations, and repositories
  model-gateway/       AI SDK provider boundary and structured generation
  shared/              Shared types and errors
  summarize/           Window selection, segmentation, prompts, and summary runtime
```

## Architecture

Microsonya is split into three independent orbits:

```text
Telegram Bot  <->  Summarize Runtime  <->  Model Gateway  <->  LLM Provider
```

### 1. Telegram Bot: transport only

The bot accepts Telegram updates and sends Telegram replies. It does not own memory, summary policy, model selection, cache behavior, or database rules.

Its job is intentionally small:

- convert Telegram messages into internal `ChatMessage` values;
- pass messages and commands into the runtime boundary;
- send the final runtime response back to Telegram;
- log operational errors.

The bot should be replaceable by another transport later, for example Discord, Slack, CLI, or HTTP, without rewriting summarization logic.

### 2. Summarize Runtime: product logic

The runtime is the middle layer. It decides what should be stored, what message window should be summarized, how messages are segmented, when cached segment summaries can be reused, and how partial summaries become the final reply.

The runtime depends on ports, not Telegram:

- message repository;
- summary repository;
- model interface.

That makes it testable without Telegram and keeps the chat product behavior in one place.

### 3. Model Gateway: provider boundary

The model gateway hides provider details from the runtime. It uses AI SDK Core for text and Zod-validated structured generation, the OpenRouter AI SDK provider for server-side model fallback, and the generic OpenAI-compatible provider for local services such as Ollama.

The runtime asks for a segment summary or final merge. It does not care whether the answer came from OpenRouter, Ollama, a local model, or another compatible API.

### Storage Boundary

The bot does not store anything by itself. Storage belongs behind the runtime/repository boundary:

- raw messages are persisted through `MessagesRepo`;
- summary runs and segment cache are persisted through `SummariesRepo`;
- database schema and migrations live in `@microsonya/db`.

This keeps the system modular: transport can change, storage can evolve, and model providers can be swapped without collapsing the whole app into one coupled bot process.

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

| Name                       | Required                    | Description                                                                  |
| -------------------------- | --------------------------- | ---------------------------------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN`       | Yes                         | Token for the Telegram bot.                                                  |
| `STORAGE_MODE`             | No                          | `postgres` (default) or `memory`.                                            |
| `MODELS_MODE`              | No                          | `openai-compatible` (default) or `disabled`.                                 |
| `DATABASE_URL`             | Yes unless `db` is disabled | Postgres connection string used by Drizzle and local bot runs.               |
| `OPENROUTER_TOKEN`         | Usually                     | OpenRouter API token. Used when `LLM_API_KEY` is not set.                    |
| `LLM_API_KEY`              | Usually                     | Generic OpenAI-compatible API key. Takes precedence over `OPENROUTER_TOKEN`. |
| `LLM_BASE_URL`             | No                          | OpenAI-compatible base URL. Defaults to `https://openrouter.ai/api/v1/`.     |
| `LLM_MODEL`                | No                          | Single segment-summary model. If empty, the fallback list is used.           |
| `LLM_MODELS`               | No                          | Ordered OpenRouter fallback for structured segment summaries.                |
| `LLM_MERGE_MODEL`          | No                          | Plain-text merge model. Defaults to `openrouter/free`.                       |
| `LLM_QUARANTINE_MODELS`    | No                          | Comma-separated models to remove from the fallback list.                     |
| `LLM_ROUTER_MODE`          | No                          | `production` enables local three-tier routing; default is `disabled`.        |
| `LLM_ROUTER_CHEAP_MODEL`   | Router only                 | Cheap tier; defaults to `gpt-oss:20b`.                                       |
| `LLM_ROUTER_DEFAULT_MODEL` | Router only                 | Default tier; defaults to `qwen3.5:9b`.                                      |
| `LLM_ROUTER_QUALITY_MODEL` | Router only                 | Quality tier; defaults to `deepseek-v4-pro:cloud`.                           |
| `POSTGRES_DB`              | Docker only                 | Database name for the Compose Postgres service.                              |
| `POSTGRES_USER`            | Docker only                 | Database user for the Compose Postgres service.                              |
| `POSTGRES_PASSWORD`        | Docker only                 | Database password for the Compose Postgres service.                          |
| `POSTGRES_PORT`            | Docker only                 | Host port mapped to Postgres. Defaults to `5432`.                            |

To use a local Ollama or another OpenAI-compatible endpoint, change `LLM_BASE_URL`, `LLM_MODEL`, `LLM_MERGE_MODEL`, and `LLM_API_KEY` according to that provider. Multiple `LLM_MODELS` are sent to OpenRouter as one server-side fallback route; generic compatible endpoints use the first configured model. Segment summaries default to temperature `0.1`, a 1000-token output limit, strict structured output, and providers that support every requested parameter. Plain-text merges use `openrouter/free` by default.

For production routing through Ollama, set `LLM_ROUTER_MODE=production`. Prompts below 2,000 estimated tokens use the cheap model, prompts from 2,000 to 11,999 use the default model, and larger prompts use the quality model. Failures escalate toward the quality tier and then degrade to any remaining tier. Three consecutive failures open that model's circuit for 30 seconds. Thresholds and circuit settings can be changed with `LLM_ROUTER_DEFAULT_MIN_INPUT_TOKENS`, `LLM_ROUTER_QUALITY_MIN_INPUT_TOKENS`, `LLM_ROUTER_FAILURE_THRESHOLD`, and `LLM_ROUTER_CIRCUIT_COOLDOWN_MS`.

For bot-only exploration without Postgres persistence, set:

```env
STORAGE_MODE=memory
```

In this mode messages are kept in memory for the current process only. To inspect Telegram message parsing and bot behavior without calling an external model provider, use:

```env
STORAGE_MODE=memory
MODELS_MODE=disabled
```

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

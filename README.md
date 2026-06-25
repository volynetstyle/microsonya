# Microsonya

On-demand incremental chat summarization for Telegram groups.

The system is split into three boring, useful parts:

- Telegram Bot: collects messages and delivers replies.
- Summarize Runtime: owns memory, window selection, segmentation, cache, and policies.
- Model Gateway: talks to any OpenAI-compatible, Ollama, local, or custom model endpoint.

The bot is deliberately not smart. The runtime is.

## Workspace

```text
apps/
  telegram/bot/
packages/
  db/
  model-gateway/
  shared/
  summarize/
```

## Runtime Model

1. Store raw text messages.
2. Select a recent summary window.
3. Split the window into discussion segments.
4. Summarize each segment with cache by message hash.
5. Merge segment summaries into a short Telegram reply.

No embeddings, person graph, vector DB, or long-term memory are required for V0.1.

## Packages

- `@microsonya/db`: Drizzle Postgres schema, client, and repositories.
- `@microsonya/summarize`: window selection, segmentation, prompts, summary orchestration.
- `@microsonya/model-gateway`: model provider abstraction and OpenAI-compatible/Ollama clients.
- `@microsonya/shared`: shared types and errors.
- `@microsonya/telegram-bot`: Telegram adapter.

## Commands

- `/summarize` summarizes messages after the last successful summary, within the last 12 hours, up to 500 messages.
- `/summarize today` summarizes text messages from the current local day.
- `/summarize 100` summarizes the last 100 text messages, clamped to 500.

## Setup

```bash
pnpm install
cp .env.example .env
pnpm build
pnpm test
```

Set `TELEGRAM_BOT_TOKEN` and `DATABASE_URL`. By default the examples point the model gateway at OpenRouter's OpenAI-compatible endpoint and a free model.

## Drizzle

Schema lives in `packages/db/src/schema.ts`. The root `drizzle.config.ts` writes generated migrations to `packages/db/src/migrations`.

```bash
pnpm --filter @microsonya/db generate
pnpm --filter @microsonya/db migrate
```

## Run

```bash
pnpm build
pnpm start
```

## Docker

Use `.env.docker.example` as the shape for `.env`. The compose setup starts a local Postgres container and stores its data in the `postgres-data` volume.

```bash
pnpm docker:build
pnpm docker:up
pnpm docker:logs
```

Docker Desktop or another Docker daemon must be running before `pnpm docker:build`.

For Render, use the web service Dockerfile and set `DATABASE_URL`, `TELEGRAM_BOT_TOKEN`, `LLM_BASE_URL`, `LLM_MODEL`, and `LLM_API_KEY`/`OPENROUTER_TOKEN` in the service environment.

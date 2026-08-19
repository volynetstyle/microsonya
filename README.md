# Microsonya

On-demand chat summarization and an incremental semantic-memory runtime for
Telegram groups.

Microsonya stores Telegram group messages and answers `/summarize` commands
through an OpenAI-compatible model provider such as OpenRouter. The model
extracts evidence-grounded claims and produces a concise natural summary;
runtime code validates, caches, persists, and renders the result.

## What Is Inside

```text
apps/
  telegram/bot/        Telegram adapter and command handling
packages/
  db/                  Drizzle schema, migrations, and repositories
  discourse/           Production claims-v6 prompt, schema, and PIPECHAT/3
  model-gateway/       AI SDK provider boundary and structured generation
  shared/              Shared production types
  summarize/           Window selection, segmentation, prompts, and summary runtime
experimental/
  discourse/           Legacy event reconstruction, projection, and salience
  eval/                Offline datasets, model runners, scoring, and reports
  tools/               Non-production memory views and legacy utilities
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

The runtime is the middle layer. It decides what should be stored, what message
window should be summarized, how messages are segmented, when cached discourse
reconstructions can be reused, and how their events become the final reply.

The runtime depends on ports, not Telegram:

- message repository;
- summary repository;
- model interface.

That makes it testable without Telegram and keeps the chat product behavior in one place.

### Semantic memory: state first, summary second

The incremental memory vertical slice is exposed as `processChatDelta` from
`@microsonya/summarize`:

```text
new messages + relevant active memory
                  |
                  v
          semantic model
                  |
                  v
             MemoryOp[]
                  |
                  v
 validation + deterministic reconciliation
                  |
                  v
      operation log + materialized MemoryState
                  |
          +-------+-------+
          |               |
          v               v
      retrieval        summary view
```

The runtime normalizes message order, participant labels, reply edges, the
processed-message watermark, evidence references, lifecycle transitions,
stable `mem_*` IDs, versions, hashes, and the applied-operation log. The model
only proposes typed semantic changes. A deterministic renderer is available
for debugging; an LLM renderer may be added later, but it must receive an exact
runtime-selected set of memory items.

`/summarize` schedules this memory pipeline outside the synchronous response
path. New messages are read after the persisted watermark in batches of 100.
Each result is committed atomically with optimistic state-version checking; a
concurrent writer causes the runtime to reload and retry. `summary_runs` stores
rendered command results; `segment_summaries` caches versioned discourse
reconstructions despite its historical table name.

### Discourse reconstruction and projection

```text
messages -> LLM discourse events -> deterministic projection -> Telegram text
```

The model returns orthogonal properties such as speech act, literalness,
commitment, epistemic status, relations, and evidence. It cannot directly emit
decisions or open questions. Runtime invariants require positive commitment
evidence for decisions and resolving answer edges for question closure.
Projection, salience ranking, and rendering are separate modules.

#### Memory invariants

> **The model may propose changes to memory, but only the runtime may mutate memory.**

- Every persistent item has evidence.
- Every mutation is recorded.
- No item is silently overwritten.
- Summary is a view, not state.
- Model output is untrusted input.

### 3. Model Gateway: provider boundary

`SummarizationModelService` (in `@microsonya/model-gateway`) knows the domain
operations — reconstruct a segment, extract memory ops, render a summary —
and nothing about providers. It talks only to the `ModelClient` port
(`generateText`/`generateObject`). `DefaultModelClient` implements that port
by delegating to a `TextGenerator` and a `StructuredGenerator`, chosen once
at startup by `createSummarizationModelService`, never re-decided per call.

Concretely: `AiSdkGenerator` implements both capabilities through one AI SDK
OpenAI-compatible model — a single interface for every endpoint (Ollama,
OpenRouter, or any other OpenAI-compatible API) rather than a client per
provider. `OllamaStructuredGenerator` is the one addition: when
`LLM_STRUCTURED_TRANSPORT=ollama-native` (the default), structured generation
goes through Ollama's own `/api/chat` JSON mode instead of the
OpenAI-compatible schema translation, which is more reliable for
schema-constrained output. Which transport to use is explicit configuration,
not inferred from the base URL.

The runtime asks for a structured segment reconstruction. It does not care
whether it came from Ollama, OpenRouter, a local model, or another compatible
API.

### Storage Boundary

The bot does not store anything by itself. Storage belongs behind the runtime/repository boundary:

- raw messages are persisted through `MessagesRepo`;
- materialized semantic state and its append-only operation log are persisted
  through `MemoriesRepo`;
- summary runs and segment cache are persisted through `SummariesRepo`;
- database schema and migrations live in `@microsonya/db`.

This keeps the system modular: transport can change, storage can evolve, and model providers can be swapped without collapsing the whole app into one coupled bot process.

The semantic-memory database model is additive:

- `memory_states` stores one versioned materialized state per chat, including
  the processed-message watermark, runtime ID sequences, and JSONB memory
  items;
- `memory_operations` stores immutable typed operations, evidence-bearing
  message ranges, input hashes, prompt/model provenance, and the state version
  that applied each operation;
- the two tables are written in one transaction. Existing summary tables are
  not modified or removed.

## Requirements

- Node.js 22 or newer
- pnpm 10.12.1 or newer
- PostgreSQL 16 or newer only when using the optional Postgres storage mode
- Telegram bot token from `@BotFather`
- OpenAI-compatible API key, for example an OpenRouter token

## Quick Start With Docker

This is the easiest path for a fresh machine. The default Compose stack starts
only the bot and persists its in-memory database in the `memory-data` volume.

```bash
cp .env.docker.example .env
```

Edit `.env` and set:

- `TELEGRAM_BOT_TOKEN`
- `OPENROUTER_TOKEN` or `LLM_API_KEY`

Then build and start the bot:

```bash
pnpm install
pnpm docker:build
pnpm docker:up
pnpm docker:logs
```

The Postgres implementation remains available as an optional migration path.
Start its Compose profile and run migrations only when `STORAGE_MODE=postgres`:

```bash
docker compose --profile postgres up -d
pnpm db:migrate
```

## Local Start

The default local setup needs no database service.

```bash
pnpm install
cp .env.example .env
```

Edit `.env` and set:

- `TELEGRAM_BOT_TOKEN`
- `OPENROUTER_TOKEN` or `LLM_API_KEY`

Prepare and run:

```bash
pnpm build
pnpm test
pnpm start
```

## Environment Variables

All model-related variables below are read in exactly one place —
`packages/model-gateway/src/modelConfig.ts`'s `loadModelConfig` — so there
is a single source of truth for defaults regardless of which app runs it.

| Name                        | Required      | Description                                                                  |
| ---------------------------- | ------------- | ---------------------------------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN`        | Yes           | Token for the Telegram bot.                                                  |
| `STORAGE_MODE`              | No            | `memory` (default) or `postgres`.                                            |
| `MEMORY_FILE_PATH`          | Memory mode   | JSON snapshot path. Defaults to `.data/memory.json`.                         |
| `MODELS_MODE`               | No            | `enabled` (default) or `disabled`.                                           |
| `DATABASE_URL`              | Postgres mode | Postgres connection string used by Drizzle and local bot runs.               |
| `WMA_URL`                   | No            | Public URL of the Web Mini App (`apps/telegram/wma`). Must be `https://` for Telegram to open it in-app; unset disables the `/app` command. |
| `OPENROUTER_TOKEN`          | No            | OpenRouter API token. Used when `LLM_API_KEY` is not set.                    |
| `LLM_API_KEY`               | No            | Generic OpenAI-compatible API key. Takes precedence over `OPENROUTER_TOKEN`. Only required when `LLM_BASE_URL` is not a local endpoint. |
| `LLM_BASE_URL`              | No            | OpenAI-compatible base URL. Defaults to a local native Ollama server at `http://localhost:11434`. |
| `LLM_STRUCTURED_TRANSPORT`  | No            | `ollama-native` (default) or `openai-compatible`. Explicit — not guessed from `LLM_BASE_URL`; switch it together when changing providers. |
| `LLM_MODEL`                 | No            | Single segment-summary model. If empty, `LLM_MODELS` or the default is used. |
| `LLM_MODELS`                | No            | Comma-separated models; only the first is used.                              |
| `LLM_MERGE_MODEL`           | No            | Plain-text merge model. Defaults to reusing the primary model.               |
| `LLM_MEMORY_MODEL`          | No            | Dedicated memory extraction model. Defaults to `gpt-oss:20b-cloud`.          |
| `LLM_QUARANTINE_MODELS`     | No            | Comma-separated models to remove from the configured list.                   |
| `POSTGRES_DB`               | Docker only   | Database name for the Compose Postgres service.                              |
| `POSTGRES_USER`             | Docker only   | Database user for the Compose Postgres service.                              |
| `POSTGRES_PASSWORD`         | Docker only   | Database password for the Compose Postgres service.                          |
| `POSTGRES_PORT`             | Docker only   | Host port mapped to Postgres. Defaults to `5432`.                            |

Ollama is the default transport: `LLM_BASE_URL` points at a local native
Ollama server by default, and `LLM_STRUCTURED_TRANSPORT=ollama-native` picks
its native JSON mode for structured generation. To use OpenRouter or another
OpenAI-compatible endpoint instead, change `LLM_BASE_URL`, `LLM_MODEL`,
`LLM_MERGE_MODEL`, `LLM_API_KEY`, and set `LLM_STRUCTURED_TRANSPORT=openai-compatible`.
Segment summaries default to temperature `1`, a 2048-token output limit,
strict structured output, and providers that support every requested
parameter. There is one model per client — no tiered routing or per-model
fallback list; that was an OpenRouter free-model-era feature that added
complexity this single self-hosted Ollama endpoint doesn't need.

Memory extraction uses `LLM_MEMORY_MODEL` independently of the summary path.
It is scheduled after the user-facing summary path and does not delay the
Telegram reply. Independent summary segments run with a bounded concurrency of
three while result ordering stays deterministic.

Each summary command emits `Summary waterfall` JSON events for message/window
loading, segmentation, cache hit/miss, prompt construction, model wait,
persistence, rendering, and background memory batches. `Model call telemetry`
adds the selected model, correlation IDs, input/output/reasoning tokens and,
for native Ollama calls, total/load/prompt-eval/eval durations. Prompt and
response bodies are deliberately excluded from these telemetry events.

Telegram progress disclosure is latency-aware: responses under one second show
nothing, one-to-three-second requests use only the native typing action, and a
single editable status message appears after three seconds. After ten seconds
it may name the current measured runtime stage and show known message/segment
counts. After twenty seconds it adds a `Скасувати` button that aborts active
model requests. The UI never invents LLM thoughts or unmeasured thread counts.

The default storage keeps its working set in process memory and writes every
mutation to an atomically replaced local JSON snapshot:

```env
STORAGE_MODE=memory
MEMORY_FILE_PATH=.data/memory.json
```

The snapshot restores messages, summary runs, cached reconstructions, and
semantic memory after a process restart. It is intended for a single bot
process during the first production iteration; use Postgres before running
multiple replicas. To inspect Telegram message parsing and bot behavior without
calling an external model provider, use:

```env
STORAGE_MODE=memory
MODELS_MODE=disabled
```

## Telegram Commands

- `/summarize` summarizes messages after the last successful summary, within the last 12 hours, up to 500 messages.
- `/summarize today` summarizes text messages from the current local day.
- `/summarize 100` summarizes the last 100 text messages, clamped to 500.
- `/app` sends a button opening the Web Mini App (`apps/telegram/wma`) at `WMA_URL`. Replies with an explanatory message instead if `WMA_URL` is unset.

## Development

```bash
pnpm build
pnpm typecheck
pnpm test
```

To test the bot and the Web Mini App together — the `/app` command and the
page it opens — without configuring models or a database:

```bash
pnpm dev:webapp
```

This runs the bot (`STORAGE_MODE=memory`, `MODELS_MODE=disabled`) and the
Vite dev server for `apps/telegram/wma` side by side, with `WMA_URL` pointed
at `http://localhost:3000`. Telegram rejects non-`https://` URLs in inline
buttons outright, so `/app` sends the link as plain text instead of a button
for you to open manually — enough to check the page itself, just not the
in-app Telegram UI. Requires `TELEGRAM_BOT_TOKEN` in `.env`, same as any
other bot run; to see the real in-app mini-app experience — the native
`web_app` button, opening inside Telegram instead of an external browser —
tunnel the Vite server:

```bash
pnpm dev:webapp:tunnel
```

Requires [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
(`winget install --id Cloudflare.cloudflared`, or `brew install cloudflared`).
`scripts/dev-webapp-tunnel.mjs` starts the WMA dev server, opens a
`cloudflared` tunnel to it, parses the resulting `https://*.trycloudflare.com`
URL out of its output, and launches the bot with that URL as `WMA_URL`
directly — no manual copying into `.env`, no restart. Ctrl-C stops all three
processes together. The URL is random and changes on every run (it's never
written to `.env`) unless you're on a paid Cloudflare plan with a named
tunnel; `pnpm tunnel:wma` runs just the tunnel on its own, e.g. to reuse a
fixed URL across bot restarts by pasting it into `WMA_URL` in `.env` instead.

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

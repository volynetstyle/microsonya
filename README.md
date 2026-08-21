# Microsonya 0.1

Telegram bot that stores chat messages and creates an on-demand Ukrainian summary with one structured model call.

```text
Telegram -> PostgreSQL messages -> Summarizer -> Model -> Telegram reply
```

Production consists of `apps/telegram/bot` and `shared`, `db`, `model`, and `summarize` packages.

Copy `.env.example` to `.env`, then run:

```bash
pnpm install
pnpm db:migrate
pnpm typecheck
pnpm test
pnpm build
pnpm start
```

The bot exposes `/summarize`; `today` and numeric count arguments are supported.

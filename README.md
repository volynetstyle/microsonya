# Microsonya 0.1

Telegram bot that keeps messages in memory and creates an on-demand Ukrainian summary with one structured model call.

```text
Telegram -> in-memory messages -> Summarizer -> Model -> Telegram reply
```

Production consists of `apps/telegram/bot` and `shared`, `model`, and `summarize` packages.

Copy `.env.example` to `.env`, then run:

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm start
```

The bot exposes `/summarize`; `today` and numeric count arguments are supported.

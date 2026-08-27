# Microsonya 0.1

Telegram bot that keeps canonical text messages in memory and creates on-demand
Ukrainian summaries.

```text
Telegram payload
    -> Telegram adapter
    -> ChatMessage
    -> window selection
    -> ConversationWindow W
         |-> derived structural views
         |-> classifier: W -> SummaryDecision
         `-> summarizer: W -> Summary
```

`ConversationWindow` is the only semantic model input. `PIPECHAT` is not a
domain type: it is the one model-facing serialization `P = encodePipe(W)`.
Classifier and summarizer prompts use the same `PIPE_FIELDS`, `PIPE_GUIDE`, and
`encodePipeWindow()`, so their transcript sections are byte-identical for the
same W. Only their policies differ.

The domain enforces these invariants:

- Telegram DTOs stop at the application boundary.
- Canonical messages use branded chat, message, author, and timestamp values.
- A window is non-empty, single-chat, chronological, unique by message ID, and
  deeply immutable.
- Reply parents may be outside the visible window; that fact is evidence, not
  an automatic policy decision.
- Derived turns and structural analysis never modify W.
- `SummaryDecision` is policy; `WindowDisposition` is the factual processing
  result.
- Deferred windows remain eligible; summarized and skipped windows advance the
  processing cursor.
- Every `SummaryRecord` carries its covered first/last message IDs and exact
  visible-message count.

A normal `SUMMARIZE` path makes two structured model calls: classification,
then summarization over the same W. A `DEFER_*` or `SKIP_*` result needs only the
classifier call. The deterministic classifier contract exists but abstains in
v0.1 until explicit fast rules are approved.

Production consists of `apps/telegram/bot` and the `shared`, `model`, and
`summarize` packages. Runtime storage is currently in-memory; the DB package
contains compatible PostgreSQL adapters and migrations.

Copy `.env.example` to `.env`, then run:

```bash
pnpm install
pnpm check
pnpm build
pnpm start
```

The bot exposes `/summary`; `today` and numeric count arguments are
supported.

Set `SUMMARIZATION_LOG_PROMPT=1` temporarily to include the complete PIPECHAT
window sent to the classifier and summarizer in telemetry. It contains chat
content and should remain disabled outside diagnostics.

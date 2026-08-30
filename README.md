# Microsonya 0.1

Telegram bot that keeps canonical text messages and creates on-demand Ukrainian
summaries.

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
- Production output is evidence, never ground truth. Every `/summary` attempt
  is an immutable run with encrypted input/output snapshots; feedback only
  places evidence in a review queue.

A normal `SUMMARIZE` path makes two structured model calls: classification,
then summarization over the same W. A `DEFER_*` or `SKIP_*` result needs only the
classifier call. The deterministic classifier contract exists but abstains in
v0.1 until explicit fast rules are approved.

Production runs on Cloudflare Workers in `apps/cloudflare`: a Telegram webhook
ingress, durable lifecycle service, Queue consumer/processor, and WMA API with
static assets. Domain logic remains in the workspace packages. PostgreSQL
stores canonical messages plus an immutable summary attempt ledger. Runtime
configuration and deployment instructions live in
`apps/cloudflare/README.md` and the Wrangler configurations under
`apps/cloudflare/workers`.

PostgreSQL never stores raw Telegram chat IDs, author IDs, author names, message
text, summaries, model text output, feedback comments, or corrections. Chat and
author identifiers use domain-separated keyed HMAC lookup values; private text
uses randomized authenticated AES-256-GCM ciphertext. Message sequence numbers,
timestamps, reply relationships, actions, statuses, and latency remain
operational metadata, but cannot be joined back to a real Telegram chat without
the application key. Keep the encryption key outside the database and its
backups.

Copy `.env.example` to `.env`, then run:

```bash
pnpm install
pnpm db:migrate
pnpm check
pnpm build
pnpm release:gate
```

Deploy the individual Workers with the `deploy:*` scripts from the
`@microsonya/cloudflare` workspace. Staging has separate Wrangler
configurations and resources; it is the required proving ground before a
production deployment.

The bot exposes `/summary`; `today` and numeric count arguments are
supported.

Set `SUMMARIZATION_LOG_PROMPT=1` temporarily to include the complete PIPECHAT
window sent to the classifier and summarizer in telemetry. It contains chat
content and should remain disabled outside diagnostics. Full prompt and model
response logging is rejected when `NODE_ENV=production`.

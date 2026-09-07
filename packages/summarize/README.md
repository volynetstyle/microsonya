# Summarization runtime 0.1

The persisted `SummaryRun` is the checkpoint. There is no separate cursor write:
a terminal `SUMMARIZE` or `SKIP_*` advances the checkpoint only after
`saveRun(...)` succeeds, while every `DEFER_*` leaves it unchanged.

Reply parents behind the checkpoint are selected as typed `context`; only
`eligible` messages contribute to `SummaryRecord.covers` and the persisted run.
The model can see both groups in its canonical window.

Production evidence is accumulated by the required per-run
`SummaryExecutionJournal` and persisted in the summary ledger. The optional
`SummaryExecutionObserver` receives the same typed execution events but is not a
source of persisted evidence. Disabling or breaking the observer cannot change
the workflow result or ledger provenance.

Verbose per-stage event emission is disabled when `NODE_ENV=production`;
development runs additionally emit the per-stage stream, including one
aggregate `summary.run` event per command with:

- action and final status;
- eligible and context message counts;
- classifier, summarizer, and total latency;
- model-call count;
- checkpoint advancement;
- the in-process consecutive defer count for the same persisted cursor;
- a stable error code when the run fails.

The defer streak is intentionally process-local in 0.1. It is observability, not
a policy change or a multi-instance consistency guarantee.

Stable error codes are `MODEL_TIMEOUT`, `MODEL_PROVIDER_ERROR`,
`MODEL_OUTPUT_INVALID`, `MODEL_OUTPUT_EMPTY`, `DELIVERY_ERROR`, and
`STORAGE_ERROR`.

Both structured and progressive generation use the same transcript and
semantic policy. Visible author labels remain in the canonical PIPECHAT input.
The policy requires concrete supported propositions instead of a catalogue of
topics, preserves relevant speaker attribution and named anchors, and forbids
generic concluding topic summaries. Progressive generation accumulates the
exact emitted content and records a final model-response envelope so its output,
latency, completion reason, and available usage counts reach the execution
journal just as they do for non-streaming generation.

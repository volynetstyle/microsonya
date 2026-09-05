# Microsonya repository context

For every task in this repository, treat
[`docs/architecture/mental-model.md`](docs/architecture/mental-model.md) as the
starting architectural context. Do not reconstruct the whole repository before
beginning ordinary work.

Use the `microsonya-architecture` repo skill for architecture, implementation,
debugging, review, data-flow, persistence, queue, lifecycle, checkpoint,
Telegram, summarization, WMA, and Cloudflare Worker tasks. The skill explains
which parts of the mental model to load for each kind of work.

The mental model is a maintained map, not authority over the current code. Its
header records the tree and commit it describes. Before relying on a claim that
could have changed, compare that baseline with the current commit and inspect
the relevant changed files. Prefer executable code, schema, migrations, config,
and tests when they disagree with the document. Preserve the document's
distinction between FACT, INFERENCE, UNKNOWN, invariants, and drift observations.

When a task changes an architectural invariant, ownership boundary, durable
state, recovery behavior, source-of-truth mapping, or one of the documented
unknowns/drifts, update the mental model in the same task. Keep the document
evidence-backed and record the new baseline commit or explicitly state that it
describes a dirty working tree.

User instructions take precedence over this repository guidance.

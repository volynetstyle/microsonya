---
name: microsonya-architecture
description: Use Microsonya's maintained architecture mental model for repository implementation, debugging, review, and design work involving Telegram ingress, summaries, checkpoints, lifecycle and retries, persistence, WMA, or Cloudflare Workers. Use it to avoid rediscovering the repository from scratch; verify potentially stale claims against current code.
---

# Microsonya architecture

Start from [`docs/architecture/mental-model.md`](../../../docs/architecture/mental-model.md).
It is the shared causal model and navigation map for this repository. Do not
repeat a repository-wide discovery pass when the document already answers the
question.

## Load only the context the task needs

- For orientation, read **How to read this document**, **System in 60 seconds**,
  and **Repository pointers**.
- For request flow or ownership, read **System context**, **End-to-end summary
  pipeline**, **Ownership model**, **Source of truth map**, and the relevant
  **Component cards**.
- For message windows or checkpoints, read **Window selection model**,
  **Checkpoint semantics**, and invariants INV-01 through INV-04.
- For queues, leases, retries, or recovery, read **Durable state**, **Summary run
  lifecycle**, **Failure and recovery model**, **Failure walkthrough**, and
  invariants INV-05 through INV-11.
- For database or transaction changes, read **Persistence and transaction
  boundaries**, **Source of truth map**, and the relevant component cards and
  invariants.
- For architectural review or design, also read **Package and platform
  boundaries**, **Where bugs are most likely to hide**, **Architecture drift
  observations**, and **Unresolved questions**.

Use the document's linked source files and tests as the next inspection targets.
Do not load every linked file unless the task genuinely spans the whole system.

## Check freshness before relying on details

Read the baseline commit and dirty-tree note in the document header. Compare
them with the current `git rev-parse HEAD` and `git status --short`. If the tree
has moved, inspect the diff or history only for files relevant to the current
claim. Current code, schema, migrations, config, and tests override stale prose.

Treat labels precisely:

- FACT is an implementation-backed observation.
- INFERENCE is a derived conclusion, not a tested guarantee.
- UNKNOWN requires product or deployment clarification.
- An invariant is expected behavior that changes must preserve or deliberately
  revise.
- A drift observation is a known mismatch or risk, not automatically the task's
  desired behavior.

## Keep the model reusable

Update the mental model when completed work changes system flow, component
ownership, durable state, transaction boundaries, recovery semantics,
architectural invariants, source-of-truth mappings, or resolves/adds a documented
drift or unknown. Cite concrete repository evidence and refresh the baseline
description. Do not add implementation trivia that does not improve future
decisions.

The user's current instructions take precedence over this skill.

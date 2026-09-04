# Classifier RC evaluation — 2026-09-03

Model: `gpt-oss:120b-cloud`; reasoning: low; seed: 0; classifier-only full
suite: 48 runs (47 model calls plus the empty-window fixture).

| Regime             | Boundary safe | Cost-weighted loss | Critical | Irreversible | Durable FN | Durable FP | Premature summary | Reply errors | Schema mismatch |
| ------------------ | ------------: | -----------------: | -------: | -----------: | ---------: | ---------: | ----------------: | -----------: | --------------: |
| A0 legacy          |        90.48% |                175 |        1 |            1 |          1 |          0 |                 0 |            1 |               0 |
| A1 v4, no capsules |        80.95% |                300 |        2 |            4 |          3 |          1 |                 1 |            0 |               0 |
| A2 v4 RC           |        88.10% |                275 |        2 |            3 |          3 |          0 |                 1 |            0 |               0 |

Result: **RC blocked**. A2 fixes the targeted reply-resolution error but fails
the zero-critical gates and regresses against A0 in both primary safety scores.
No inference patch was made in response; follow-up changes require fixture-level
failure analysis.

## Exemplar order robustness

Five safety fixtures were run once under each fixed permutation E1–E5.

| Order                 | Accepted actions | Cost | Safety failure                                  |
| --------------------- | ---------------: | ---: | ----------------------------------------------- |
| E1 reversed           |              5/5 |   20 | none                                            |
| E2 rotate             |              5/5 |   20 | none                                            |
| E3 seeded permutation |              4/5 |  120 | `incomplete-memory-leak` prematurely summarized |
| E4 seeded permutation |              4/5 |   40 | `forwarded-message-provenance` deferred         |
| E5 seeded permutation |              5/5 |   20 | none                                            |

Result: **order robustness gate failed**. E3 introduced a critical unsafe
premature summary.

## A2 stability

The stability slice ran seven fixtures five times each. Mean dominant-action
stability was 97.14%, minimum 80%; one fixture was unstable. The accepted action
rate was 85.71%. `live-prod-version-vs-time` consistently returned
`DEFER_INCOMPLETE` and failed its accepted-action contract.

## End-to-end G0/G1 diagnostic

Adversarial A1/A2 runs exposed a downstream summarizer blocker. For each selected
`SUMMARIZE` action, the model returned a substantive plain-text summary while the
structured path expected a JSON object. Those runs became
`MODEL_OUTPUT_INVALID_JSON`. Consequently this E2E sample cannot establish a
capsule effect on attribution; classifier-only results remain valid.

Raw local reports are in `.data/classifier-rc/`:

- `a0-all.json`, `a1-all.json`, `a2-all.json`;
- `a2-e1-targeted.json` through `a2-e5-targeted.json`;
- `a2-stability-5.json`;
- `a1-adversarial-e2e.json`, `a2-adversarial-e2e.json`.

The commands and comparator contract are documented in `test/README.md`.

## Boundary-fix follow-up

Predicate-divergence reporting now identifies the first decision-tree predicate
whose actual value conflicts with the expected action constraints. The first
targeted X0-X3 run found:

| Variant                            | Boundary safe | Corrected cost | Critical | Durable FN | Premature summary |
| ---------------------------------- | ------------: | -------------: | -------: | ---------: | ----------------: |
| X0 pre-boundary, five examples     |        42.86% |            320 |        2 |          2 |                 1 |
| X1 strengthened, no examples       |        42.86% |            320 |        2 |          2 |                 1 |
| X2 strengthened, two hard examples |    **71.43%** |        **120** |    **0** |          1 |             **0** |
| X3 strengthened, five examples     |        28.57% |            260 |        0 |          2 |                 0 |

The corrected costs include expanded extraction fixtures; an evaluator bug that
previously omitted those fixtures from aggregate cost was fixed after the raw
runs. X2 is the best targeted variant but remains blocked by one durable false
negative: `long-numeric-type-collision@front`.

B0 and B1 had the same 42.86% targeted BoundarySafeRate. B0 cost 175 and B1
cost 155; both had one DurableFN and one critical error. This sample does not
implicate native roles or JSON Schema as the primary regression source.

Summarizer plaintext normalization removed all provider/parse errors in the
follow-up adversarial E2E run (previous A2 sample: five errors; normalized sample:
zero). The run produced four summaries with no retry call. Actor-attribution
coverage remains incomplete because the proposition fixtures selected for
summarization did not provide a valid actor-attribution evaluation sample.

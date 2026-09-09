# Microsonya Cloudflare observability contract

The cluster uses three complementary signal planes:

1. Cloudflare invocation metrics for CPU, wall time, status, and runtime errors.
2. Workers Logs and traces for sparse, structured operational correlation.
3. Analytics Engine dataset `microsonya_runs` (or its staging equivalent) for
   application metrics and SLOs.

Application telemetry is auxiliary. It cannot change an HTTP response, RPC
result, Queue ACK/retry decision, lifecycle transition, model result,
persistence result, or Telegram delivery result.

## Privacy boundary

Analytics points never contain chat IDs, Telegram message IDs, author IDs or
names, run IDs, prompts, message text, model response text, summaries, SQL, or
raw exception messages. Workers Logs may contain opaque run IDs for operational
correlation, but never conversation content or external identity. Traces use
opaque run IDs and bounded attributes; Telegram chat/message identifiers are
not attached.

## Base metric schema

| Slot    | Meaning                                   |
| ------- | ----------------------------------------- |
| index1  | bounded `component:outcome`               |
| blob1   | event name                                |
| blob2   | outcome                                   |
| double1 | duration in milliseconds, when applicable |

## Summarization event schema

All summarization events use the bounded index `processor:summary`.

| Slot    | Meaning                                            |
| ------- | -------------------------------------------------- |
| blob1   | event type                                         |
| blob2   | status/result                                      |
| blob3   | stage/source                                       |
| blob4   | action/reason                                      |
| blob5   | stable error code                                  |
| blob6   | mode/bounded rule                                  |
| double1 | duration or trace offset ms                        |
| double2 | eligible message count                             |
| double3 | context message count                              |
| double4 | model calls or input tokens (event-dependent)      |
| double5 | classifier ms or output tokens (event-dependent)   |
| double6 | summarizer ms or character count (event-dependent) |
| double7 | checkpoint advanced, `0` or `1`                    |

The `summary.run` event is the canonical run-level row. Model envelope events
provide token and latency distributions without retaining model text.

## Useful SQL

Run outcomes and latency:

```sql
SELECT
  blob2 AS status,
  COUNT() AS runs,
  AVG(double1) AS avg_ms,
  QUANTILE(0.95)(double1) AS p95_ms,
  SUM(double4) AS model_calls
FROM microsonya_runs
WHERE index1 = 'processor:summary'
  AND blob1 = 'summary.run'
  AND timestamp > NOW() - INTERVAL '24' HOUR
GROUP BY status
ORDER BY runs DESC
```

Window usefulness and checkpoint safety:

```sql
SELECT
  blob4 AS action,
  blob2 AS status,
  COUNT() AS runs,
  AVG(double2) AS avg_eligible_messages,
  AVG(double3) AS avg_context_messages,
  SUM(double7) AS checkpoints_advanced
FROM microsonya_runs
WHERE index1 = 'processor:summary'
  AND blob1 = 'summary.run'
  AND timestamp > NOW() - INTERVAL '7' DAY
GROUP BY action, status
```

Model latency and token volume:

```sql
SELECT
  blob3 AS stage,
  COUNT() AS calls,
  QUANTILE(0.50)(double1) AS p50_ms,
  QUANTILE(0.95)(double1) AS p95_ms,
  SUM(double4) AS input_tokens,
  SUM(double5) AS output_tokens
FROM microsonya_runs
WHERE index1 = 'processor:summary'
  AND blob1 = 'model.response.envelope'
  AND timestamp > NOW() - INTERVAL '24' HOUR
GROUP BY stage
```

Queue outcomes:

```sql
SELECT blob1 AS event, blob2 AS outcome, COUNT() AS events
FROM microsonya_runs
WHERE index1 LIKE 'ingress:%'
  AND timestamp > NOW() - INTERVAL '24' HOUR
GROUP BY event, outcome
```

## One-window safety argument

A useful terminal result requires all of these independently tested
properties:

1. `ConversationWindow` is a defensive, deeply frozen, chronological,
   single-chat value with unique message IDs.
2. Selection distinguishes eligible messages from context-only reply parents.
3. The classifier and summarizer receive exactly the same selected window.
4. A terminal summary is assigned coverage from eligible messages, even if a
   model returns different coverage.
5. The checkpoint advances only after durable persistence succeeds.
6. The persisted attempt ledger records input hash, ordered message snapshots,
   model invocation evidence, policy hash, latency, and exact coverage.
7. Telemetry emits counts, stages, actions, timings, and stable codes only.
8. Complete telemetry failure cannot change the result or persisted coverage.

The executable proof is the test named `keeps a useful one-window result
correct when telemetry completely fails`, supported by the window, pipeline,
checkpoint, model-output, and ledger test suites.

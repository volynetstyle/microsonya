# Observability architecture

This document defines the repository-wide boundary between application facts,
durable execution evidence, and operational telemetry. It applies to packages,
Cloudflare Workers, tests, and future runtime adapters.

## Core invariant

Removing, disabling, sampling, or replacing observability must not change:

- domain results or control flow;
- persisted state or execution evidence;
- retry, checkpoint, lease, or delivery semantics;
- error classification visible to application policy.

An observability adapter may fail internally, but that failure must not escape
into application execution. This is enforced for summarization provenance by
`INV-12` in the architecture mental model.

## Three information classes

| Class                 | Examples                                                                    | Owner                                           |
| --------------------- | --------------------------------------------------------------------------- | ----------------------------------------------- |
| Domain state          | action, disposition, checkpoint, lifecycle status                           | domain/workflow and durable repositories        |
| Execution evidence    | model invocation, model/profile, prompt hash, token counts, accepted output | execution journal and attempt ledger            |
| Operational telemetry | spans, logs, latency distributions, error rates                             | optional observers and platform instrumentation |

Execution evidence is not telemetry. A single typed execution event may feed
both the required evidence journal and optional observers, but persistence may
read only from the journal or explicit domain values.

```text
execution fact
    +--> required journal --> durable attempt evidence
    +--> optional observer --> traces / logs / metrics
```

## Instrumentation boundaries

1. Instrument package public operations, handlers, and meaningful application
   phases that may be slow or fail.
2. Prefer span events or typed execution events for internal milestones.
3. Do not duplicate spans for HTTP, Queue, Service Binding, or other operations
   already instrumented by the runtime unless application semantics add value.
4. Instrument ports with decorators at the composition root when the core does
   not need the emitted fact for domain behavior or durable evidence.
5. Library packages expose neutral observer/recorder interfaces. Runtime hosts
   own SDKs, exporters, sampling, Cloudflare bindings, and backend choices.

The default mapping is:

| Boundary                    | Operation examples                                                           |
| --------------------------- | ---------------------------------------------------------------------------- |
| `@microsonya/summarize`     | `summary.process`, `summary.classify`, `summary.generate`, `summary.persist` |
| Cloudflare ingress          | `summary.command.accept`, Queue message handling                             |
| Cloudflare processor        | processing and delivery coordination                                         |
| Lifecycle repository/Worker | lifecycle commands and reconciliation                                        |

Function names, parsing helpers, individual awaits, and runtime-instrumented
binding calls are not span boundaries by default.

## Event and projection rules

- Emit one typed fact once. Logs, traces, metrics, and evidence are projections.
- Evidence projections are required and deterministic with respect to their
  input events. Operational projections are optional and failure-isolated.
- Metrics answer aggregate questions and use bounded dimensions. Run, chat,
  message, trace, prompt, and other unbounded identifiers must not be metric
  dimensions.
- Logs are structured and must not contain prompts, model output, Telegram
  content, SQL, bound values, secrets, or arbitrary exception messages.
- Trace attributes may carry safe correlation IDs when useful. Ambient context
  is limited to correlation and request metadata, never checkpoints, selected
  messages, decisions, results, or other business state.
- Error observations retain safe classifications or error names, while domain
  error mapping remains owned by workflow policy.

## Package API rule

Packages must not depend on Cloudflare Analytics Engine, Cloudflare tracing,
exporters, or a concrete telemetry backend. A package may expose:

```ts
interface ExecutionObserver<Context, Event> {
  start(context: Context): ExecutionRecorder<Event>;
}

interface ExecutionRecorder<Event> {
  record(event: Event): void;
}
```

The host supplies the observer. Required journals are constructed by the
application workflow and are never replaced by a no-op observer.

OpenTelemetry instrumentation, when introduced into a reusable package, should
depend only on the stable API; SDK setup and exporters belong to the host. Use a
package or instrumentation-library name and version as the instrumentation
scope.

## Review checklist

- Does removing the observer preserve the returned value and persisted rows?
- Is durable provenance produced without reading telemetry state?
- Does one fact fan out through projections instead of repeated calls?
- Is a custom span an application operation rather than an infrastructure await?
- Are metric dimensions bounded?
- Are logs structured, redacted, and failure-isolated?
- Is ambient context correlation-only?
- Are runtime-specific dependencies confined to an application adapter?

## Primary references

- [OpenTelemetry: instrumentation libraries](https://opentelemetry.io/docs/concepts/instrumentation/libraries/)
- [OpenTelemetry: instrumentation scopes](https://opentelemetry.io/docs/concepts/instrumentation-scope/)
- [OpenTelemetry Trace API and span events](https://opentelemetry.io/docs/specs/otel/trace/api/)
- [Cloudflare Workers traces](https://developers.cloudflare.com/workers/observability/traces/)
- [Cloudflare Workers spans and attributes](https://developers.cloudflare.com/workers/observability/traces/spans-and-attributes/)
- [Cloudflare Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)

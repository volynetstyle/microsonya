# `@microsonya/production-readiness`

Machine-readable lifecycle, recovery, and release invariants for Microsonya.
This package does not claim that a persistence adapter exists: real Workers must
prove these contracts with database concurrency and crash-injection tests.

The residual delivery guarantee is deliberately explicit: logical runs can be
exactly-once and processing at-least-once, while Telegram delivery remains
best-effort exactly-once because a successful external send followed by a crash
before the durable delivery marker is intrinsically ambiguous.

# Summarization

`@microsonya/summarize` turns stored conversation history into a decision,
optional summary, and durable attempt evidence. The host supplies history,
persistence, model clients, and optional observer adapters.

## Where to make a change

The layout follows `@microsonya/telegram`: related operations use dotted names
at the package root; specialized implementations live together; each stateful
class has its own file. `src/index.ts` explicitly lists the public API. Internal
modules import their dependencies directly, without intermediate barrels.

| Responsibility                                         | Entry point                                                                    | Supporting modules                                                                |
| ------------------------------------------------------ | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Compose dependencies and serialize commands per chat   | [`summary.workflow.ts`](src/summary.workflow.ts)                               | `execution/serialization.ts`, `execution/attempt.ts`                              |
| Host contracts and injection seams                     | [`summary.dependencies.ts`](src/summary.dependencies.ts)                       | Model, history, attempt store, selector, observer and preview contracts           |
| Select eligible messages and reply context             | [`summary.window.ts`](src/summary.window.ts)                                   | `window/eligible.ts`, `ranking.ts`, `context.ts`, `chronology.ts`, `selection.ts` |
| Decide whether to summarize and generate a disposition | [`summary.evaluation.ts`](src/summary.evaluation.ts)                           | `classifier/`, `generation/`                                                      |
| Accept terminal semantic results                       | [`generation/acceptance.ts`](src/generation/acceptance.ts)                     | `generation/schema.ts`, `generation/validation.ts`, `summary.outcome.ts`          |
| Identify reusable input snapshots                      | [`summary.input.ts`](src/summary.input.ts)                                     | Policy identity, ordered role snapshots and input hash                            |
| Render a disposition for the user                      | [`summary.presentation.ts`](src/summary.presentation.ts)                       | Shared skip/defer messages                                                        |
| Collect and persist execution evidence                 | [`SummaryAttemptRecorder.ts`](src/execution/SummaryAttemptRecorder.ts)         | `SummaryExecutionJournal.ts`, `record.ts`, `dataset.ts`, `reuse.ts`               |
| Publish progressive output                             | [`ProgressiveSummarySession.ts`](src/progressive/ProgressiveSummarySession.ts) | `ProgressiveScheduler.ts`, `SerializedPublisher.ts`, `cadence.ts`, `transport.ts` |

## Model boundary

- `model/transcript.ts` owns the PIPECHAT schema, encoder and record validator.
  `model/prompt.ts` wraps that transcript with policy and input-role sections.
- `classifier/predicates.ts` owns the strict predicate schema and deterministic
  action policy. `classifier/instructions.ts` owns the active classifier prompt;
  `classifier/classifier.ts` owns the model call and bounded output retry.
- `generation/prompt.ts` composes the trusted policy and user input. Instructions,
  composition constraints, contrast examples and output schemas have named files.
- `generation/summarizer.ts` returns a `SummaryCandidate` containing grounded
  prose fragments, never an accepted summary. Each fragment has `text`, eligible
  `evidence`, and `subjects` linking visible authors to their own evidence.
- `generation/generate-accepted.ts`, called by the workflow after every generator
  including injected implementations, owns mandatory acceptance and one shared
  local repair budget. `acceptance.ts` checks schema, evidence, subject provenance,
  numeric anchors and protocol leakage. `reviewer.ts` supplies an L2 model review;
  `review.ts` requires exactly one verdict for every fragment and rejects any
  semantic failure. Canonical text is composed only from accepted fragments.
- L2 checks entailment, visible attribution, entity relations, speech acts,
  epistemic state and supersession against the whole window. It is probabilistic
  model judgment, not a deterministic guarantee of entailment. The standard path
  adds one reviewer call; latency and rejection rates need live evaluation.

Consumers injecting a generator must return `SummaryCandidate`, not `{ text }`.
They must also provide `semanticReviewer` or an Ollama client for the standard
reviewer. Injection never disables schema/evidence validation or verdict coverage.

Model code does not select messages or persist attempts. Prompt changes can alter
cached-result validity: review `SUMMARY_POLICY_VERSION` in `summary.input.ts`
when changing semantic policy. The grounded-fragment/review contract uses policy
v3, preventing exact-input cache reuse of results accepted by the old policy.

Invalid generation JSON/schema or rejected fragments get at most one local
repair. A malformed review retries only the review, retaining the candidate.
The budget is shared: a second output/acceptance failure terminates processing.
The classifier independently allows one output repair (larger token budget only
for empty/truncated output). The host does not retry model-output errors as a
whole run; transient HTTP/network/timeout failures retain infrastructure retry.
`ModelInvocationEvidence.stage` distinguishes classifier, summarizer and reviewer;
review latency is available on its invocation and included in total latency,
without inflating summarizer latency. Review rejection details stay in repair
data and durable model evidence, not operational error messages.

## Execution and persistence

`createSummaryWorkflow()` is the composition entry point. Its `process()` method
serializes commands for the same chat within that workflow instance. Distributed
ownership, leases and retries remain the host's responsibility.

`executeSummaryAttempt()` controls selection, exact snapshot reuse, evaluation,
semantic acceptance and persistence. `SummaryAttemptRecorder` owns the
per-attempt journal and builds the record passed to the attempt store.
`buildAttemptRecord()` is a pure transformation; the repository owns the actual
transaction and its ownership fence. A rejected commit remains an
`AttemptCommitConflict`. A failed attempt write is not retried as a second
write of error evidence.

Only eligible messages contribute to coverage. Reply parents provide context.
`recent` commands may advance consumption after a committed summary or intentional
skip; `count` and `today` queries remain read-only. Deferred, empty and failed
attempts do not advance consumption. The selector retains the existing time,
ordering and bounded-selection policies.

Execution events live in `execution/events.ts`. The required journal consumes
them independently of optional observers in `execution/observer.ts` and the
logging adapter in `execution/telemetry.ts`. Disabling or breaking an observer
must not change the result or persisted evidence. Defer streaks remain local to
the workflow instance. See the repository's
[observability contract](../../docs/architecture/observability.md).

Progressive presentation is downstream from acceptance and persistence.
`finalize()` flushes a preview of already accepted text; `commit()` performs
final delivery only after the host has durably saved that text. Telegram-specific
transports belong to `@microsonya/telegram`.

## API changes in this refactor

The package name and `createSummaryWorkflow()` entry point are unchanged.

| Previous name                                             | Current name                                                               |
| --------------------------------------------------------- | -------------------------------------------------------------------------- |
| `processWindow`                                           | `evaluateSummaryWindow`                                                    |
| `WindowProcessorDeps`                                     | `SummaryEvaluationDependencies`                                            |
| `WindowProcessingResult`                                  | `SummaryEvaluationResult`                                                  |
| `pendingSummaryWindowSelector`                            | `defaultSummaryWindowSelector`                                             |
| `ClassifierDeps`                                          | `ClassifierDependencies`                                                   |
| `ConversationSummarizerDeps`                              | `ConversationSummarizerDependencies`                                       |
| `outputSchema`                                            | `summaryOutputSchema`                                                      |
| `selectConversationWindow(messages, command, checkpoint)` | `selectSummaryWindow({ messages, command, checkpointBefore: checkpoint })` |
| `selectMessages(...)`                                     | `selectSummaryWindow(...)?.eligibleMessages ?? []`                         |

Repository callers use the new names. The removed wrappers and old directory
barrels are not retained as compatibility layers.

## Validation

Run from the repository root:

```sh
pnpm --filter @microsonya/summarize typecheck
pnpm typecheck:tests
pnpm exec vitest run test/summarize-boundaries.test.ts test/summarize-v01.test.ts test/summary-workflow-concurrency.test.ts test/window-pipeline.test.ts test/summary-cache.test.ts test/summary-ledger-runtime.test.ts test/semantic-acceptance.test.ts test/classifier.test.ts test/model-transcript-parity.test.ts test/pipechat.test.ts test/progressive-summary.test.ts test/count-checkpoint.test.ts test/checkpoint-policy.test.ts test/error-taxonomy.test.ts test/derived-views.test.ts
```

Selection tests compare bounded ranking against chronological selection over
shuffled histories. Workflow tests cover chat isolation, recovery after a failed
queued operation, snapshot reuse, historical coverage, persistence failures,
observer isolation, semantic rejection, and progressive presentation.

The design uses explicit responsibility boundaries and vocabulary
([Bounded Context](https://martinfowler.com/bliki/BoundedContext.html)), extraction
of meaningful operations
([Extract Function](https://refactoring.com/catalog/extractFunction.html)), and
descriptive TypeScript names
([Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html)).
Repository conventions take precedence over external formatting preferences.

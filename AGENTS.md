# Microsonya repository guidance

## Source-code navigation

Use Serena as the default interface for navigating source code.

### Semantic traversal economy

- Do not follow type references when the type definition already establishes
  the shape needed for the task.
- Do not inspect sibling symbols merely because they share a lexical prefix;
  follow data/control-flow evidence instead.
- For large symbols, prefer narrow pattern queries inside the known file when
  only a few operations or relationships need verification. Read the full
  symbol body only when its internal control flow is itself relevant.
- Once a semantic reference identifies the next concrete symbol, follow that
  symbol directly. Do not request a file overview unless the next symbol name
  is genuinely unknown.

### Symbol lookup

- Prefer exact symbol queries with `relative_path` when the symbol is known.
- Prefer `substring_matching = false` for known symbols.
- If the symbol name inside a known file is unknown, call
  `get_symbols_overview` before guessing names.
- Do not issue repeated speculative `find_symbol` calls.

### References

- Use `find_referencing_symbols` first for semantic references.
- Treat unexpectedly sparse results as potentially incomplete across
  TypeScript package or project boundaries.
- When semantic references appear incomplete, fall back to a narrowly scoped
  `search_for_pattern`, restricted by directory, extension, or known subsystem
  whenever possible.

### Context expansion

- Read symbol bodies only when implementation details are necessary.
- Prefer the smallest symbol that establishes the required behavior.
- Do not read a large enclosing function when targeted symbols or reference
  snippets already establish the relevant relationship.
- Expand source context progressively.
- Avoid whole-file reads unless the task genuinely requires file-wide context.

### Tool calls

- Batch independent Serena queries in the same model turn.
- Use sequential queries only when a later query depends on an earlier result.
- Prefer structured semantic navigation over broad repository search.
- Use textual search primarily for literals, documentation, configuration,
  generated strings, or when semantic navigation is insufficient.

## Architecture context

`docs/architecture/mental-model.md` is the maintained architectural map of
Microsonya.

`docs/architecture/observability.md` defines the repository-wide separation of
domain state, durable execution evidence, and operational telemetry. Read it
before adding spans, logs, metrics, execution journals, telemetry dependencies,
or observability decorators.

Do not load it wholesale and do not read its beginning as generic bootstrap.

For tasks that depend on architecture, ownership, lifecycle, persistence,
recovery, consumption boundaries, queue behavior, summarization flow, WMA, or
Cloudflare execution semantics, use the `microsonya-architecture` repo skill to
select only the relevant mental-model sections.

For small local implementation tasks whose behavior and ownership are already
clear from the code, do not load architectural documentation unnecessarily.

The mental model is a map, not authority over the current implementation.

Before relying on a claim that may have changed:

1. Check the mental-model baseline against the current commit.
2. Determine whether files relevant to the claim changed since that baseline.
3. Inspect only those changed or task-relevant files.
4. Prefer executable code, schema, migrations, configuration, and tests when
   they disagree with documentation.

Preserve the document's distinction between:

- `FACT`
- `INFERENCE`
- `UNKNOWN`
- invariants
- drift observations

Do not silently promote inference or drift into intended behavior.

## Maintaining architecture context

Update `docs/architecture/mental-model.md` in the same task when a change
affects any of the following:

- architectural invariants;
- ownership boundaries;
- durable state;
- recovery behavior;
- source-of-truth mappings;
- consumption semantics;
- documented unknowns or drift.

Keep updates evidence-backed.

When updating the baseline:

- record the new commit when the tree is clean;
- otherwise explicitly state that the model describes a dirty working tree.

## Durable context ownership

Repository architectural knowledge belongs to:

- `docs/architecture/mental-model.md`;
- the `microsonya-architecture` repo skill;
- this repository guidance.

Do not use Serena memories or Serena onboarding as a second architectural
memory system.

## Priority

User instructions take precedence over this repository guidance.

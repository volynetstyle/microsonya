## Live golden evaluation

The regular `pnpm check` never calls a remote model. To evaluate the golden
contract against `gpt-oss:120b-cloud`, set `OLLAMA_HOST=https://ollama.com` and
`OLLAMA_API_KEY` in `.env`, then run:

```sh
pnpm eval:live:smoke
pnpm eval:live:stability
pnpm eval:live:extraction
pnpm eval:live -- --fixture durable-70k-pc-story --runs 20
pnpm eval:live -- --suite all --model gpt-oss:20b-cloud --output .data/e2e-20b.json
```

To run the prompt ablation matrix with the same five seeds, execute:

```sh
pnpm eval:live -- --suite extraction --summarizer-only --prompt-variant V0 --runs 5 --seed 100 --output .data/summary-v0.json
pnpm eval:live -- --suite extraction --summarizer-only --prompt-variant V1 --runs 5 --seed 100 --output .data/summary-v1.json
pnpm eval:live -- --suite extraction --summarizer-only --prompt-variant V2 --runs 5 --seed 100 --output .data/summary-v2.json
pnpm eval:live -- --suite extraction --summarizer-only --prompt-variant V3 --runs 5 --seed 100 --output .data/summary-v3.json
```

The variants are cumulative: V0 is the former single-user-message prompt, V1
adds native system/user role separation, V2 adds semantic composition rules,
and V3 adds the two adversarial contrasts. By default, every live generation
run uses the production path: plain-text instructions, `stream: true`, no
`format`, and the progressive orchestrator branch. Run number `N` uses
`seed + N`, and the chosen variant, generation path, and initial seed are
recorded in the JSON report. `--summarizer-only` deterministically selects
`SUMMARIZE`, so classifier behavior and cost cannot hide or confound generation
differences.

Use `--generation-path structured-diagnostic` only for a separate diagnostic of
the non-production JSON-schema path. It is not a release-generation gate.
The runtime defaults to V2; V3 remains opt-in until a broader ablation proves a
gain over V2 rather than a tie.

The stability suite runs each known decision-boundary fixture five times and
reports its action distribution, dominant-action stability, and accepted-action
rate. `expected.action` remains the preferred label; explicitly declared
`acceptableActions` count only toward policy behavior accuracy.

The runner writes a JSON report to stdout and progress to stderr. A non-zero exit
means the release gate failed: a critical or irreversible error occurred, a
provider/parse call failed, product-safe action rate fell below 90%, or semantic
proposition score fell below 90%. Preferred-label accuracy is diagnostic only.
Use `--timeout-ms`, `--suite`, `--runs`, and `--output` to override defaults and
persist a report. Use `--model` to run the frozen fixture contract against a
different Ollama model without changing the runtime model profiles. Use
`--prompt-variant` and `--seed` for controlled V0-V3 comparisons.
Repeat `--fixture` to evaluate a selected group of fixtures in one report.

### Classifier RC evaluation

Production is frozen to classifier regime A2. The regime flags below exist only
for offline evaluation:

- `A0`: previous production prompt, seven booleans, and legacy reducer;
- `B0`: legacy policy/schema with native system/user roles;
- `B1`: B0 plus a real JSON Schema transport contract;
- `A1`: predicate-v4 with native roles and JSON Schema, without reply capsules;
- `A2`: the release candidate, including reply-context capsules.

Run the action-only matrix without allowing downstream summarizer failures to
replace a valid classifier action with `EMPTY`:

```sh
pnpm eval:live -- --suite all --classifier-only --classifier-regime A0 --exemplar-order E0 --seed 0 --json --output .data/classifier-rc/a0-all.json
pnpm eval:live -- --suite all --classifier-only --classifier-regime A1 --exemplar-order E0 --seed 0 --json --output .data/classifier-rc/a1-all.json
pnpm eval:live -- --suite all --classifier-only --classifier-regime A2 --exemplar-order E0 --seed 0 --json --output .data/classifier-rc/a2-all.json
```

`E0` is canonical order. `E1` is reversed, `E2` is rotated, and `E3` through
`E5` are fixed permutations. Run those orders against the targeted safety
fixtures, then compare every report:

```sh
pnpm eval:classifier:compare -- .data/classifier-rc/a0-all.json .data/classifier-rc/a1-all.json .data/classifier-rc/a2-all.json .data/classifier-rc/a2-e1-targeted.json
```

The primary classifier score is `classifierSafety.costWeightedLoss`. Reports
also contain BoundarySafeRate, DurableFN/FP, critical and irreversible loss,
unsafe premature summaries, actor/reply errors, schema mismatch rate, action
distribution, classifier latency, and classifier prompt tokens. The comparator
requires zero safety-critical errors and no regression from A0 in either
BoundarySafeRate or CostWeightedLoss.

Use a separate ordinary end-to-end run for A1/A2 when evaluating whether reply
capsules alter summarizer attribution or overweight context. `--classifier-only`
must not be used for that G0/G1 comparison.

Boundary-policy ablations use `--classifier-exemplars X0|X1|X2|X3`: X0 is the
saved pre-boundary policy with five examples, X1 is the strengthened procedure
without examples, X2 keeps only the durable and incomplete contrasts, and X3
uses the strengthened procedure with all five examples. Start with targeted
durable/incomplete/referent fixtures and do not proceed to the full suite until
the zero-critical gates pass.

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
and V3 adds the two adversarial contrasts. Structured output remains enabled in
every variant so the ablation changes only the three factors under test. Run
number `N` uses `seed + N`, and the chosen variant and initial seed are recorded
in the JSON report. `--summarizer-only` deterministically selects `SUMMARIZE`,
so classifier behavior and cost cannot hide or confound generation differences.
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

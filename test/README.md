## Live golden evaluation

The regular `pnpm check` never calls a remote model. To evaluate the golden
contract against `gpt-oss:120b-cloud`, set `OLLAMA_HOST=https://ollama.com` and
`OLLAMA_API_KEY` in `.env`, then run:

```sh
pnpm eval:live:smoke
pnpm eval:live:stability
pnpm eval:live:extraction
pnpm eval:live -- --fixture durable-70k-pc-story --runs 20
```

The stability suite runs each known decision-boundary fixture five times and
reports its action distribution, dominant-action stability, and accepted-action
rate. `expected.action` remains the preferred label; explicitly declared
`acceptableActions` count only toward policy behavior accuracy.

The runner writes a JSON report to stdout and progress to stderr. A non-zero exit
means the release gate failed: a critical or irreversible error occurred, a
provider/parse call failed, product-safe action rate fell below 90%, or semantic
proposition score fell below 90%. Preferred-label accuracy is diagnostic only.
Use `--timeout-ms`, `--suite`, `--runs`, and `--output` to override defaults and
persist a report.

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

The runner writes a JSON report to stdout and progress to stderr. A non-zero exit
means accuracy fell below the configured threshold, irreversible loss occurred,
checkpoint behavior diverged, or the provider failed. Use
`--minimum-accuracy`, `--timeout-ms`, `--suite`, and `--runs` to override defaults.

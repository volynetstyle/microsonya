# baseline-v1

Status: **RELEASE GATE FAILED — NOT CLEARED FOR SHIP**

Evaluation date: 2026-08-27  
Model: `gpt-oss:120b-cloud`  
Endpoint: `https://ollama.com/api`  
Source revision before baseline artifacts: `2d97aa478e9d5a944fbe4969510ac4a911195490`

## Frozen contract

No classifier prompt, summary prompt, or policy changes were made while creating
this baseline. The following hashes identify the frozen inputs:

| Input | SHA-256 |
| --- | --- |
| `packages/summarize/src/classifier.ts` | `06ac0fa5ffec55a5c9dd25c676efffe375887245817c676a1e1b6cbf97e88965` |
| `packages/summarize/src/conversationSummarizer.ts` | `f8f3809d55aa5b2e8035a3011966aece54f72e91ea75abb222003a9a466fc596` |
| `packages/summarize/src/constants.ts` | `92ac87eaa92714bb26ce4d827715a283e69ec6332bc920b092a81c2d4a4ee87d` |
| `packages/summarize/src/checkpointPolicy.ts` | `8a618c52ada8f227468b9807e2373eb9899990733cfa6136a322a23b3ca3b680` |

Evaluator scope is frozen after this baseline. A `baseline-v2` may be opened only
for a production defect, a new error class, or a product-contract change.

## Release gate

| Gate | Required | Observed | Result |
| --- | ---: | ---: | --- |
| Critical errors | 0 | 1 | FAIL |
| Irreversible losses | 0 | 1 | FAIL |
| Runtime E2E | 4/4 | 4/4 | PASS |
| Provider/parse failures | 0 | 0 across all final live reports | PASS |
| Product-safe action rate | >= 90% | 92.68% full; 88.57% boundary; 100% long-context | FAIL on boundary |
| Semantic proposition score | >= 90% | 90.54% full; 87.50% boundary; 92.00% long-context | FAIL on boundary |

Preferred-label accuracy is diagnostic and is not a release gate.

## Reports

- `full-semantic.json`: 43 fixtures, 65 model calls, 0 provider/parse
  failures. Product-safe action rate `38/41`; proposition score `67/74`.
- `boundary-5-runs.json`: 7 fixtures x 5 runs, 50 model calls, 0
  provider/parse failures. Product-safe action rate `31/35`; proposition score
  `28/32`.
- `long-context.json`: 21 placements, 41 model calls, 0 provider/parse
  failures. Product-safe action rate `21/21`; proposition score `69/75`.
- `runtime-e2e.json`: deterministic local runtime scenarios `4/4` passed.

The full-suite critical failure was `forwarded-message-provenance`, classified as
`SKIP_NO_VALUE`. Because the content was meaningful and the checkpoint advanced,
the run records one irreversible loss. This is not reclassified as a harmless
boundary mismatch.

The proposition reports were deterministically recalculated on the captured
model outputs after correcting confirmed evaluator false positives. Model calls
were not replayed or cherry-picked during that recalculation.

## Commands

```sh
pnpm eval:live -- --suite all --runs 1 --timeout-ms 180000 --json --output baselines/baseline-v1/full-semantic.json
pnpm eval:live:stability -- --timeout-ms 180000 --json --output baselines/baseline-v1/boundary-5-runs.json
pnpm eval:live:extraction -- --runs 1 --timeout-ms 180000 --json --output baselines/baseline-v1/long-context.json
pnpm exec vitest run test/runtime-e2e.test.ts --reporter=json --outputFile=baselines/baseline-v1/runtime-e2e.json
pnpm check
```

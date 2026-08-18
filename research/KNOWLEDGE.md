# Microsonya research knowledge base

Дата сводки: 2026-08-18. Это накопленная карта знаний, а не ещё один benchmark
score. Каждый вывод помечен уровнем уверенности:

- **A — operational fact:** напрямую следует из данных или deterministic code;
- **B — validated pattern:** поддержан interval/permutation/rolling validation,
  но ещё не доказана переносимость на другие чаты;
- **C — exploratory:** descriptive pattern с ограниченной выборкой;
- **D — not established:** гипотеза, которую нельзя использовать как правило.

## 1. Executive summary

1. Dataset годится для структурного исследования одного чата, но не для
   обобщений на Telegram и не для честного summary benchmark: reference
   summaries отсутствуют, а 100% записей — forwarded imports.
2. Reply graph важнее одной temporal-сегментации. Практический baseline —
   30-minute coarse sessions + reply expansion + hard token/message cap.
3. Metadata даёт умеренный сигнал для soft ranking (rolling AUC около 0.64),
   но недостаточен для hard filtering и не заменяет semantic reconstruction.
4. Raw author IDs и длинная identity history переобучаются. Переносятся лучше
   structural roles: streak, active authors, pair exchange, reply relation,
   session position и relative text length.
5. Photo→photo и service→service transitions сильные, но, вероятно, частично
   технические (albums/service bursts), а не человеческие намерения.
6. Для summary на 12 сбалансированных cases лучший operational trade-off —
   `gpt-oss:120b` direct: около 6.2 s, macro precision 0.629 и evidence overlap
   0.673. Более крупные модели дают больше recall, но медленнее и менее
   селективны.
7. Deterministic reducer нужен для persistent memory и lifecycle invariants,
   но не окупается в synchronous summary path GPT-OSS: он добавил примерно
   16 s и ухудшил precision/evidence в paired comparison.
8. Простое DeepSeek selective top-k не достигло желаемой точки
   `recall≈0.98, precision≥0.63`: при recall ≥0.95 leave-one-case-out выбрал
   отсутствие фильтрации.

## 2. Evidence map

### Dataset analysis

Основные generated artifacts находятся в [`out/`](out/):

- [`summary.md`](out/summary.md) — полный legacy report;
- [`features.csv`](out/features.csv) — одна строка на сообщение и derived
  metadata;
- [`dataset_quality_audit.csv`](out/dataset_quality_audit.csv) — coverage,
  duplicates, ordering и import bias;
- [`session_boundary_stability.csv`](out/session_boundary_stability.csv) и
  [`session_metrics.csv`](out/session_metrics.csv) — threshold trade-offs;
- [`reply_time_survival.csv`](out/reply_time_survival.csv) и
  [`rolling_reply_validation.csv`](out/rolling_reply_validation.csv) — timing
  и leakage-safe prediction;
- [`memory_curve_permutation_baseline.csv`](out/memory_curve_permutation_baseline.csv)
  и [`structural_author_memory_baseline.csv`](out/structural_author_memory_baseline.csv)
  — corrected memory effects;
- `kind_transition_*`, `reply_*`, `structural_*`, `text_length_*` — supporting
  diagnostics.

Исторический runner/documentation: commit `9ca4995` содержит
`research/src/*`, `research/main.mjs`, `dataset-deep-analysis.md` и
`telegram-mtproto-deep-research.md`. В текущем checkout они не materialized;
поэтому generated output сейчас — evidence artifact, но не самодостаточный
reproduction package.

### Model/eval analysis

Model eval реализован в [`packages/eval`](../packages/eval/). Основные
artifacts/commands:

- `model-screening-v1`: 13 cases × 3 models × 2 pipelines;
- `selective`: offline DeepSeek claim-selection ablation без новых model calls;
- [`packages/eval/README.md`](../packages/eval/README.md) — contract и metrics;
- [`packages/eval/src/report.ts`](../packages/eval/src/report.ts) — stage reports;
- [`packages/eval/src/runSelectiveAblation.ts`](../packages/eval/src/runSelectiveAblation.ts)
  — top-k/evidence/reply-centrality sweep.

## 3. Dataset contract and limitations

После clean cutoff `2026-05-22T00:00:00Z`:

| Property | Value |
| --- | ---: |
| clean messages | 2,874 |
| raw records | 2,878 |
| chats | 1 destination chat |
| author identities | 44 |
| source date range | 2026-05-22 → 2026-06-22 |
| known reply edges | 1,187 |
| reply ratio | 41.3% [39.5%, 43.1%] |
| duplicate message keys | 0 |
| chronological reply validity | 100% |
| adjacent source-order inversions | 908 |
| collection span | 4,992 seconds |

Message kinds:

- text 81.0%; photo 10.1%; service 5.3%; sticker 3.6%.
- median text length 26 chars; p90 124; p99 444; max 1,354.
- median inter-message gap 25 s; p90 1,406 s; p99 21,400 s.

Critical caveats:

- `forwarded_ratio=1.0` — import artifact, not behavior;
- destination chat ID is not the original source peer;
- collection time is not conversation time;
- no complete edit/delete/reaction/topic/grouped-album history;
- one chat means no cross-chat generalization;
- all times in the report are UTC;
- text retention introduces higher privacy risk than metadata-only analysis.

Therefore confidence intervals describe uncertainty inside this sample; they do
not remove selection bias from manual forwarding or single-chat collection.

## 4. Temporal sessions and reply graph

### Session threshold trade-off

| Gap threshold | Sessions | Singleton share | Reply edges cut | Messages in sessions >50 |
| ---: | ---: | ---: | ---: | ---: |
| 2m | 806 | 46.5% | 50.0% | 16.1% |
| 5m | 571 | 36.6% | 35.4% | 23.2% |
| 10m | 444 | 31.1% | 25.5% | 25.1% |
| **30m** | **255** | **22.0%** | **13.7%** | **31.8%** |
| 60m | 162 | 19.1% | 7.8% | 38.1% |
| 120m | 85 | 5.9% | 3.2% | 60.8% |

**Decision (A/B):** use 30m as coarse boundary, then expand across known reply
parent/root/children edges within a hard cap. 2–10m fragments conversations;
60–120m creates oversized windows. 30m is a product compromise, not a true
semantic topic boundary.

Nontrivial reply trees cross 30m sessions in 23.8% of cases (all trees: 7.2%).
The summary window must therefore preserve logical reply components separately
from time sessions.

### Reply timing

Kaplan–Meier reply probability:

| Horizon | Probability of direct reply |
| ---: | ---: |
| 2m | 16.5% [15.2%, 17.9%] |
| 10m | 24.6% [23.1%, 26.2%] |
| 1h | 30.3% [28.6%, 32.0%] |
| 1d | 32.8% [31.1%, 34.5%] |
| 7d | 32.8% [31.1%, 34.5%] |

Among messages that eventually receive a direct reply, roughly half reply within
2m, 75% within 10m and 92% within 1h.

**Product use:** soft-close low-latency previews after 10m silence, keep a
revision window of about 1h, and include the full reply closure for historical
summary requests.

### Reply rates by kind

- text: 36.1%, posterior 36.1% [34.2%, 38.0%];
- photo: 23.6% posterior [19.1%, 28.5%];
- service: 20.2% posterior [14.5%, 26.5%];
- sticker: 8.5% posterior [4.3%, 14.0%].

Use these as ranking priors only. Do not drop photos/stickers solely by kind:
captions and reply-tree position can be semantically important.

## 5. Message-kind transitions

Stable observed transitions:

- `text → text`: P=0.900, lift=1.11, n=2,094;
- `photo → photo`: P=0.643, lift=6.34, n=187;
- `service → service`: P=0.497, lift=9.45, n=75;
- `sticker → sticker`: low base-rate but elevated self-transition.

Within-day circular permutation (999 permutations) plus BY FDR retains the major
same-kind effects. These are transition associations, not causes. Albums and
service bursts likely explain much of photo/service persistence.

**Engineering decision:** preserve `grouped_id` and media subtype in the
collector; collapse albums/service bursts before behavioral inference. Never
translate photo→photo lift into “user interest” without a larger direct sample.

## 6. Memory and online prediction

### Corrected memory

Mutual information after session-stratified permutation:

| Field | history 1 | history 2 | history 3 |
| --- | ---: | ---: | ---: |
| kind | 0.143 | 0.126 | 0.119 |
| author_id | 0.460 | 0.323 | 0.045 |
| has_reply | 0.045 | 0.046 | 0.054 |
| session_continues_30m | 0.001 | 0.011 | 0.010 |

Long author identity history collapses toward the session-aware null. Structural
roles carry more transferable signal:

- speaker streak length;
- active authors count;
- pair exchange;
- new author in session;
- author rank/top-author status;
- reply relation;
- position/time since session start;
- text length relative to that author's history.

Raw author IDs are local upper-bound baselines, not portable features.

### Reply prediction

Rolling-origin 24h validation, 872 test messages:

| Features | AUC | Brier | Log loss | ECE |
| --- | ---: | ---: | ---: | ---: |
| prevalence baseline | 0.502 | 0.232 | 0.658 | 0.050 |
| author history | 0.550 | 0.229 | 0.652 | 0.044 |
| online metadata | 0.636 | 0.219 | 0.627 | 0.032 |
| metadata + author history | 0.639 | 0.218 | 0.626 | 0.029 |

Metadata gives a modest Brier gain; author history adds only 0.003 AUC. AUC
around 0.64 is suitable for soft ranking and budgeting, not hard filtering.
Future subtree size/replies are retrospective features and must not enter the
online model.

## 7. Importance and media findings

The current structural importance score is a retrospective ranking heuristic,
not ground truth. It contains future-looking fields such as replies received,
subtree size and later activity.

Maintain two policies:

- **online importance:** relative text length, reply-to existing root, session
  starter, caption/entities, media kind, past-only author/session state;
- **retrospective importance:** reply count, subtree depth/size, author count,
  cross-session reach, later references, reactions and edits.

Photo-started 30m sessions show 52% large-session rate versus 27% baseline, but
the sample is only n=25; excluding album-like cases leaves n=13 and 38.5%.
This is a hypothesis, not a production bonus.

## 8. Model and summary evaluation

The model eval used the same Pipe v3 input, prompt, seed and cases for each model.
The balanced snapshot has 12 cases × 3 models × 2 pipelines = 72 runs and one
seed. Direct output is a final summary; shell output is reconstruction →
deterministic reducer → projection.

### Direct summary

| Model | OK | Mean latency | Macro recall | Macro precision | Evidence overlap |
| --- | ---: | ---: | ---: | ---: | ---: |
| `gpt-oss:120b` | 12/12 | **6.2s** | 0.905 | **0.629** | **0.673** |
| `qwen3.5:397b` | 12/12 | 42.5s | 0.929 | 0.466 | 0.496 |
| `deepseek-v4-pro` | 12/12 | 36.1s | **0.989** | 0.552 | 0.623 |

DeepSeek/Qwen recover more annotated content, but GPT-OSS is materially faster
and more selective under this finite gold/evidence loss. This is a Pareto
trade-off, not proof that GPT-OSS is universally smarter.

### Shell effect

Paired direct→shell deltas on successful same-case pairs:

| Model | Cases | Latency Δ | Recall Δ | Precision Δ | Evidence Δ |
| --- | ---: | ---: | ---: | ---: | ---: |
| GPT-OSS | 10 | +16.2s | −0.012 | −0.067 | −0.048 |
| Qwen | 11 | +29.0s | −0.055 | −0.002 | +0.148 |
| DeepSeek | 7 | +16.3s | 0.000 | +0.025 | +0.030 |

GPT shell also had two parse failures; DeepSeek shell had five request timeouts;
Qwen shell had one parse failure. Reducer invariant violations were zero for
successful shell runs, confirming the safety boundary but not semantic quality.

**Current product split:** GPT-OSS direct for synchronous `/summarize`; events,
reducer and state for asynchronous persistent memory where corrections,
supersession and replay matter.

### DeepSeek selective projection ablation

Stored DeepSeek direct candidates were filtered without new model calls using
hard top-k, minimum evidence, model order, evidence count and reply-centrality.
Leave-one-case-out policy selection chose no filtering whenever recall had to
remain ≥0.95.

| Policy | Weighted recall | Macro recall | Macro precision |
| --- | ---: | ---: | ---: |
| no filter | 0.982 | 0.989 | 0.552 |
| reply centrality, top-12 | 0.909 | 0.944 | 0.608 |
| reply centrality, top-8 | 0.855 | 0.908 | **0.688** |
| reply centrality, top-6 | 0.727 | 0.807 | 0.700 |

Simple deterministic ranking can buy precision only by giving up substantial
recall. A stronger verifier with entailment/support confidence is still an open
experiment; this ablation does not disprove that hypothesis.

## 9. Architecture decisions

### Collector

- use durable pagination/cursor and live updates as accelerator;
- sort by source timestamp/message ID, not imported file order;
- upsert by `(source, peer_kind, peer_id, message_id)`;
- preserve edits/deletes as event ledger + current projection;
- persist `grouped_id`, topics, entities and media subtype;
- use overlap on pagination for edits/eventual hydration;
- global history concurrency 2–4 with per-peer backoff and `FLOOD_WAIT` handling;
- keep StringSession/API credentials out of logs and repo.

### Segmentation

```text
source messages
  → 30m coarse sessions
  → reply-tree closure
  → album/service burst normalization
  → hard token/message cap
  → summary window
```

Do not treat temporal session IDs as semantic topics.

### Runtime and memory

```text
messages → semantic events → deterministic reducer → state → projections
                                      ├─ memory
                                      ├─ summary
                                      └─ UI
```

Decisions, open/resolved questions and supersession belong to runtime state,
not to an unconstrained final LLM projection. Runtime must be replayable and
testable with synthetic event logs.

### Summary path

Current evidence supports a short path:

```text
/summarize → GPT-OSS 120B direct → evidence-grounded summary
```

The full shell remains valuable for asynchronous memory, not necessarily for
every synchronous summary.

## 10. What is not established

Do not currently claim:

- generalization from this one forwarded chat;
- causality for message-kind transitions;
- portability of raw author effects;
- photo-start importance;
- factuality from evidence-overlap alone;
- production-quality summary from one seed;
- that a single composite score describes the system;
- that a deterministic top-k verifier can replace semantic entailment.

## 11. Next research backlog

### P0 — make evidence reproducible

- restore/version the research runner and config that generated `out/`;
- store commit, input hash, cutoff, timezone, seed, command and package versions
  alongside every output directory;
- resolve the generated-summary encoding issue (`В±`, `О”` mojibake);
- add a direct MTProto sample from at least five chats;
- complete Telegram Terms/privacy review before external LLM processing.

### P1 — validate product assumptions

- annotate 120–200 sessions: threads, must-include facts, decisions,
  open/resolved questions, jokes and attribution;
- leave-chat-out evaluation, not only one-chat rolling folds;
- 3–5 seeds for GPT direct on the hardest cases;
- QA factuality and human usefulness evaluation for model outputs;
- test 20B verifier against DeepSeek candidate claims with calibrated threshold.

### P2 — improve runtime

- concurrency-limited eval runner (2–3 workers) with per-call timeout;
- resume-aware short screening: 4–5 cases × 3 seeds before full grid;
- measure semantic amplification and cost per accepted claim;
- add model confidence/support fields only if they improve held-out metrics;
- compare direct summary against shell only on slices where lifecycle state is
  actually required.

## 12. Reproduction commands and artifact hygiene

Historical research runner (available in git history, not current checkout):

```powershell
node research/main.mjs `
  --input apps/telegram/bot/data/my-telegram-dataset.jsonl `
  --out research/out `
  --since 2026-05-22T00:00:00.000Z
```

Current model selective ablation:

```powershell
pnpm --filter @microsonya/eval selective
```

Generated research outputs are intentionally ignored by git. This knowledge
document should remain the versioned interpretation layer; raw CSVs remain
inspectable artifacts, not the source of product policy by themselves.

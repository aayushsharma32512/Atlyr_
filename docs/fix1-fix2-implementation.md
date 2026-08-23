# Ingestion Pipeline — Implementation Record

**Service:** `services/ingestion-automated`
**Status:** Built, tested, live-verified across four production batches (144–147, 13–14 Aug 2026).

This records what the service does **now** and why. It began as two changes — **Fix 1**, server-side bulk batching, and **Fix 2**, a multi-route Gemini transport — and grew a third body of work when the first real batches exposed failures no smoke test had reached. Where a design was reversed, the reversal and its evidence are recorded alongside the current behaviour rather than in a separate changelog.

**Contents:** [1. Bulk batching](#1-bulk-batching) · [2. Gemini transport](#2-multi-route-gemini-transport) · [3. Reliability](#3-reliability-what-production-forced) · [4. Benchmarks](#4-benchmarks) · [5. Rejected](#5-decisions-deliberately-not-taken) · [6. Open](#6-open-by-choice)

---

## 1. Bulk batching

### The problem

Bulk ingest was a browser-side loop: submit 3 jobs, poll until all 3 settle, submit the next 3. Closing the tab stopped the loop. Behind it, one pg-boss queue ran 5 workers, and slow GPU steps (segmentation, placement — minutes each) held worker slots while fast steps queued behind them. A 500-URL sheet took 8+ hours.

### What was built

**Database** — `supabase/migrations/20260813090000_add_ingestion_batches.sql` (applied)

- `ingestion_batches` table (`batch_id`, `label`, `created_by`, `total`, `created_at`).
- Nullable `batch_id` FK on `ingestion_pipeline_jobs`, partial index.

**Server** — [batches.ts](../services/ingestion-automated/src/api/routes/batches.ts), [batch-catalog.ts](../services/ingestion-automated/src/domain/batch-catalog.ts)

- `POST /batches` — up to 500 rows per request. Dedupes within the request and against the DB (the same already-active / already-ingested checks as single submit), inserts every job at `pending`, enqueues with bounded concurrency (8 lanes), returns per-row outcomes (`submitted` / `duplicate` / `rejected`).
- `GET /batches/:batchId` — rollup counts (completed / hitl / failed / running) plus slim job rows for polling.
- `GET /batches` — recent batches.

**Queue split** — [send-step.ts](../services/ingestion-automated/src/queue/send-step.ts), [worker.ts](../services/ingestion-automated/src/queue/worker.ts)

- A second queue, `run-modal-step`, carries the Modal-driven states (`segmenting`, `placement`) with its own `BOSS_MODAL_TEAM_SIZE` (default 5). Fast steps stay on `run-pipeline-step` under `BOSS_TEAM_SIZE`.
- Both queues dispatch to the same handler; the job row's `current_state` decides what runs, so which queue delivered a message never changes behaviour.
- The boot reaper checks both queue names when scanning for stranded jobs — without that it would false-reap jobs waiting on the modal queue.

**Frontend** — [useBulkIngest.ts](../src/components/ingestion-automated/useBulkIngest.ts), [ingestionV2Api.ts](../src/utils/ingestionV2Api.ts)

- One `POST /batches`, then a poll loop on the rollup. The 3-at-a-time pacing loop is gone.
- The retry sweep survives as a convenience: while the dialog is open, failed jobs restart from the step they died at, up to 3 times, one sweep per minute. Closing the tab stops only the watching — every job is already server-side.
- `created_by = 'bulk:<sheet>'` is still written per job, so dashboard grouping and cost readouts work unchanged.

### Verified

- Auth; validation (empty rows → 400); unknown batch → 404.
- Zero-cost dedupe: re-submitting an already-ingested URL returned `submitted: 0, duplicates: 1` linked to the original job, with no AI call made.
- A batch of placeholder URLs accepted, enqueued, then fully deleted via `DELETE /jobs/:id` — submit-to-enqueue for a whole batch is sub-second.
- Worker boot log shows both queues registered.

### Worker sizing

`BOSS_TEAM_SIZE` is **12** (`BOSS_MODAL_TEAM_SIZE` 5). It sat at 5 until the transport work landed, because raising it earlier would only have converted "slow" into "429". It is safe at 12 now because the two limits that punished concurrency — Firecrawl's per-minute plan cap and Gemini's per-pool quota — are enforced where they belong (§3.3, §2) rather than by starving the worker pool.

---

## 2. Multi-route Gemini transport

### The problem

Every Gemini call used one API key against AI Studio: one project, one quota pool. The model-fallback chain (`gemini-3-pro-image` → flash variants) sat four models deep behind that same pool, and a 429 was treated like a server error — retried in place, per model, then retried again by pg-boss. A rate-limit storm burned minutes per job re-asking a project that had just said stop.

### Architecture

```
adapters/gemini.ts, adapters/vton/gemini-vton.adapter.ts
        │
        ▼
adapters/llm/index.ts              config-wired singleton
adapters/llm/router.ts             the sweep: routes × models, failover decisions
adapters/llm/route-spec.ts         GEMINI_ROUTES parser
adapters/llm/gemini-transport.ts   @google/genai clients (AI Studio / Vertex)
utils/error-classify.ts            429 vs transient vs fatal, retryDelay parsing
utils/governor.ts                  per-pool concurrency, AIMD backpressure, pauses
utils/circuit-breaker.ts           per-route open / half-open / close
```

Both adapters were consolidated onto `@google/genai`. One SDK reaches both quota pools; the constructor flag is the only difference (`{apiKey}` vs `{vertexai: true, project, location}`), and model IDs are identical on both. The old raw REST call that put the API key in a URL query string is gone.

Every call records `route_used` and `attempted` (each failed route/model attempt with its error kind and duration) on the `garment_summary`, `enrichment` and `vton_image` artifacts, so a 429 storm is visible in the data afterwards instead of being silently absorbed. Most of the evidence in §4 came from those records.

### The unit of capacity is a pool, not a route

A **pool** is `route::model`. Vertex serves each model from its own Dynamic Shared Quota allocation, so an exhausted `gemini-3-pro-image` says nothing about `gemini-3.1-flash-image` beside it — measured directly: pro returning 429s while both flash models served in 6–21s. Every concurrency limit, pause and backpressure decision below is pool-scoped. The circuit breaker is the one deliberate exception (route-scoped) because a genuine 5xx storm is an endpoint property.

### How a call flows

A call **sweeps**: it walks every route in `GEMINI_ROUTES` order and every model in chain order, *skipping* pools that are paused or have no free slot. A busy pool is a reason to try the next model, and whichever pool frees first serves the call. Only when a whole sweep finds nothing but busy pools does the call wait (~0.75 s, jittered) and sweep again, logging `waiting_for_capacity` every ~30 s. A sweep that ends in real failures with nothing left to wait for throws `AllRoutesFailedError`.

| Error | Class | What happens |
|---|---|---|
| 429, or 403 with a quota reason | `rate_limited` | The **pool** pauses for the server's `retryDelay` (15 s if unspecified) and its concurrency halves — once per congestion event, not per response. Next model, same route. Never touches the breaker: the route is shared with the text-model family, whose pools may be idle. Retryable once the pause lapses. |
| 500 / 502 / 503 / 408 / network failure | `transient` | **3 in-place attempts**, exponential backoff from 2 s (full jitter, 30 s cap), then next model — and the pool is done for this call. |
| 499 / 504 (timeout-shaped) | `transient` | **No in-place retry.** The attempt already burned up to the full 240 s transport timeout proving the model is slow right now; repeating it holds the slot while a sibling serves in ~21 s. Straight to the next model. |
| 200 with no image (e.g. `IMAGE_SAFETY`) | `refused` | Next model, pool done for this call — deterministic-ish for the same input, so re-asking only spends money. |
| 404 | `not_found` | Model not served on this route — next model, no penalty, pool done for this call. |
| 400 | `fatal_input` | Nothing downstream fixes a bad request. Fail fast; no fallback masks it. |

"Pool done for this call" is per-call memory. A model that hard-failed is never re-attempted by later sweeps of the *same* call — without it, a parked call re-bought a refused image generation every ~0.75 s.

Two mechanisms run continuously underneath:

- **Governor (AIMD), pool-scoped.** A 429 halves the pool's in-flight limit (floor 1), at most once per pause window — an unpause herd produces many 429s for a single congestion signal, and halving per response collapsed 8 → 1 for one event. Ten consecutive successes add a slot back, up to `GEMINI_ROUTE_MAX_CONCURRENT` (default 8). This self-tunes to whatever each pool actually allows, which matters because DSQ publishes no number to configure.
- **Circuit breaker, route-scoped, transient-only.** Five consecutive transient failures open a route for 30 s; afterwards one probe passes. Rate limits never open it. An open route counts as "worth waiting for" during a sweep, because a 30-second cooldown must not terminally fail in-flight jobs. A probe consumed by a sweep that made no real attempt is refunded, and an unreported probe re-arms after the cooldown — without both, a burned probe wedged the route closed for the life of the process.

### Design note — why the original one-strike route switch was reversed

Fix 2 originally treated a 429 as a one-strike route switch, on the reasoning that all models on a route share a project-level cap. **That is false on Vertex**, where DSQ capacity is per model. Worse, the original blocking acquire meant a saturated pro pool (AIMD-halved to concurrency 1) serialized all 12 workers behind it: 21-second flash calls measured at up to **1,424 s** of queue wait, and batch 145's VTON stage took 38 minutes.

Replacing "wait for this pool" with "skip busy pools and sweep" is the single largest performance change in this record — VTON fell from ~38 minutes to ~4 (§4).

### Routing configuration

```
GEMINI_ROUTES="vertex:global,ai_studio"
GOOGLE_VERTEX_PROJECT="kalagriha-vertex"
GOOGLE_APPLICATION_CREDENTIALS="C:/Users/namja/.gcp/kalagriha-vertex.json"
```

Vertex is first because that project carries 90-day trial credits, so traffic burns those while they exist; AI Studio is the paid fallback. Reversing the preference is this one line.

`vertex:global` is Google's global endpoint — it places each request wherever capacity exists, which under DSQ generally beats hand-picking a region. An explicit region ladder is supported with no code change:

```
GEMINI_ROUTES="ai_studio,vertex:asia-southeast1,vertex:europe-west4,vertex:us-central1"
```

Each region is its own quota pool. **Verify a region actually serves the model before adding it** — measured 2026-08-14, `gemini-3-pro-image` and `gemini-3.1-flash-image` are published **only on `global`** for this project; the regional endpoints 404. Only `gemini-2.5-flash-image` (GA, and not in our chain) has regional endpoints. This is launch-stage behaviour — preview image models ship global-only — so re-check when either model reaches GA.

```
cd services/ingestion-automated
bun run src/scripts/check-routes.ts           # text call per route, near-free
bun run src/scripts/check-routes.ts --image   # + one image per route (~USD 0.13 each)
```

Region choice here is about capacity, not latency: generation takes 10–60 s and dwarfs any inter-region round trip.

### Model chain

```
GEMINI_IMAGE_MODEL=gemini-3-pro-image
GEMINI_IMAGE_MODEL_FALLBACKS=gemini-3.1-flash-image
```

Both are 2K-capable at the pipeline's 9:16 portrait. `gemini-2.5-flash-image` **was removed on 14 Aug**: it renders on a black background when the prompt does not pin one, and it silently returns **1K** (768×1376) while accepting `imageConfig.imageSize: '2K'` without error. Both are properties of a model generation predating 2K output — no prompt fixes either. Batch 147 confirmed removing it costs no throughput. The 12 images it had already produced were left in place.

The VTON system prompt now pins the background explicitly (plain white studio, never dark); previously it said nothing about background at all, which is what let model defaults diverge.

### Transport timeout

`REQUEST_TIMEOUT_MS` is **240 s**. `gemini-3-pro-image` at 2K measures 104–155 s, so the previous 120 s ceiling aborted legitimate in-flight generations, surfacing as 499/504 — and possibly billing for images that were then discarded.

### Cost

Vertex and AI Studio list at the same per-image price; the difference is the quota model, not the rate. The GCP project carries USD 300 in trial credits (~2,200 VTON images at USD 0.134), valid 90 days. Those credits **do not cover AI Studio**, which spends from the prepay balance against a monthly cap — see §4's spend-cap finding for why that distinction cost a day.

---

## 3. Reliability — what production forced

Four batches surfaced failures that unit tests and single-call smoke tests could not. Each fix below is in the working tree and covered by tests.

### 3.1 Queue lifecycle

**pg-boss restart loop.** A v9 instance is single-use: `stop()` then `start()` on the same object leaves the internal `stopped` flag set, so each restart leaked a maintenance timer whose every tick threw (`Cannot destructure property 'secondsAgo'`), which triggered another restart, which leaked another timer. Expire/archive silently stopped. Restarts now construct a **fresh instance** behind a stable `BossHandle` that callers hold, so route closures never enqueue onto a stopped instance; retired instances keep an error listener but are inert.

**Boot recovery** — [boot-recovery.ts](../services/ingestion-automated/src/orchestration/boot-recovery.ts), `BOOT_RECOVERY=resume`. On startup, work the previous process died holding is re-dispatched at the step it stopped on, **before the workers register**. That ordering is load-bearing: once this process is consuming, its own in-flight jobs are indistinguishable from a dead process's. It can act immediately where the reaper cannot, because at boot nothing has been consumed yet, so any `active` row provably belongs to a process that no longer exists. A crash or Ctrl-C no longer needs manual re-driving.

`GET|POST /jobs/recover` is the manual counterpart for the case boot recovery cannot cover — the service stayed up but something stalled. It uses a staleness threshold (`BOSS_STEP_TIMEOUT + BOSS_REAP_GRACE`) instead of boot's zero, because at steady state an `active` row usually means "running right now". `segmenting` and `placement` are excluded from both, since Modal patches those states out of band.

### 3.2 Dispatcher guards

A stray queue message for a job in `awaiting_hitl_*` fell through to "no handler registered" and marked the job **failed**. HITL states deliberately have no handler, so the dispatcher now skips them explicitly, as it already did for terminal states. Seven review-ready jobs — complete with VTON and segmentation — were destroyed this way in one batch before the guard existed.

### 3.3 Firecrawl

**Concurrency limiter.** `FIRECRAWL_MAX_CONCURRENCY` was parsed into config and never read, so scrape parallelism was whatever `BOSS_TEAM_SIZE` happened to be. Twelve workers put **64 requests into one minute** against a 15/min plan and killed 20 of batch 144's 24 jobs. The call now runs under the shared governor (3 in flight), honours the `retry after Ns` in the 429 body instead of retrying three times inside the same exhausted window, and treats a rate limit as retryable rather than terminal. Batch 146: zero scrape 429s.

**Key chain.** `FIRECRAWL_API_KEY` accepts a comma-separated priority list, each key its own governor pool. A **402 (out of credits)** parks that key for 6 hours and falls through immediately — unlike a 429 it does not heal, so re-asking it every scrape is pure waste. A 429 pauses only that key for the server's window; a genuine per-URL failure throws without trying the others. Batch 147 lost jobs to an exhausted key with nothing to fall back to, which is what prompted this.

### 3.4 VTON crash-safety

The image is uploaded and its artifact written several awaits before the state advances, so a crash in that window left a finished, already-paid-for image with the job still marked `generating_vton` — and recovery re-bought it. The handler now reuses an existing `vton_image` artifact instead of regenerating. A deliberate "Restart from `generating_vton`" still regenerates, because the restart route deletes the artifact first.

---

## 4. Benchmarks

Four 23–24-item topwear sheets, same shape, ~24 hours apart.

| Measure | 144 (13 Aug, pre-fixes) | 145 (mid-fixes) | 146 (all fixes) | 147 (+ spend cap lifted) |
|---|---|---|---|---|
| Through automation untouched | 4 of 24 | 21 of 23 | **24 of 24** | 21 of 23 |
| Manual interventions | many | 2 restarts | 0 | **0** |
| Submit → all at review | needed rescue | ~43 min | ~21 min (p50 11) | **~11 min** (p50 7, p90 8) |
| VTON stage | — | ~38 min, queue climbing | ~15 min, flat | **~4 min**, flat |
| Median VTON incl. queue wait | — | ~1,000 s | 94–195 s | **≈45 s** |
| Worst single VTON | — | 1,424 s | 423 s | 266 s |
| Rate limits absorbed without loss | 0 | 12 | 71 | 7 |
| Served by the primary model (pro) | — | 11 of 21 | 8 of 24 | **16 of 21** |

Losses were external, not pipeline failures: batch 144's 20 to Firecrawl 429s, 145's 2 to 499s classified fatal, 147's 2 to a Firecrawl 402 (out of credits).

**Batch 146** — scraping 5 m 25 s, limiter-paced, zero 429s. VTON minutes 6–21 for all 24; per-model medians 2.5-flash 94 s, 3.1-flash 178 s, pro 195 s, all well above raw model time because every pool took sustained 429s. Every image served by `vertex:global`. The raw VTON span reads 23 m because the operator regenerated two black-background images after the batch finished.

**Batch 147** (17:50 UTC, quieter hour) — scraping 4 m 33 s · identify 2 m 5 s · summary 2 m 13 s · **VTON 4 m 9 s for 21 images** · Modal segmentation median 36 s/job. Route split **15 AI Studio / 6 Vertex** — the first run in which AI Studio served anything. Per-model medians pro 49 s, 3.1-flash 30 s, close to raw model time. Only 7 rate limits, all on Vertex.

### The AI Studio 429s were never rate limits

Batches 144–146 recorded dozens of `ai_studio … rate_limited` attempts while AI Studio served **zero** images. The stored error bodies explain why:

```
{"code":429,
 "message":"Your project has exceeded its monthly spending cap.
            Please go to AI Studio at https://ai.studio/spend …",
 "status":"RESOURCE_EXHAUSTED"}
```

A **spend cap**, not throttling. The console showed peak 7 RPM against a 500 RPM Tier-2 limit — about 1.5% utilisation — while every call was refused. Raising the cap turned the fallback route from decorative into real, and most of batch 147's 2× speedup over 146 is exactly that: two working routes instead of one, so a Vertex pause diverts to genuine capacity instead of a billing wall.

Two consequences. **Cost** — AI Studio spends real money (trial credits exclude it), so a fast batch now carries a bill; 147's 15 AI Studio images cost roughly ₹170. **Classification** — a spend-cap 429 never heals on its own, so pausing 15 s and retrying is futile; distinguishing it from a real rate limit remains open (§6).

### Why Vertex 429s so often

Not our concurrency. A **single isolated request** to `vertex:global` was rejected in 790 ms with nothing else running, and the same call succeeded minutes later. The error names no quota metric — a genuine per-project breach names one — and the service account cannot even read project quotas (`403 PERMISSION_DENIED` on the Service Usage API). That is the Dynamic Shared Quota signature: there is no per-project allotment to exhaust or to raise. Google's own 429 guidance offers backoff, spreading load, Provisioned Throughput, or batch — never "request more quota".

`gemini-3-pro-image` is a heavily contended preview model available on exactly one endpoint for this project, so contention is the steady state and routing around it is the only lever. That is what the sweep does.

---

## 5. Decisions deliberately not taken

**Cost-aware route patience.** Batch 147 served 15 of 21 images from paid AI Studio while free Vertex went unasked for 10 of them. This is not an ordering bug — the walk *is* `vertex/pro → vertex/3.1-flash → ai_studio/pro → ai_studio/3.1-flash` — but order only ranks pools that are free *right now*, and a 15-second Vertex pause makes the sweep skip it. A patience window before falling through to a costlier route was prototyped and **reverted**: at ~11 minutes end-to-end with 16 of 21 images on the primary model, speed is worth more than credit conservation, and patience is precisely what reintroduces the queueing the sweep exists to remove. Revisit only if AI Studio's monthly cap starts binding mid-run.

**FIFO fairness among waiting workers.** A freed pool slot goes to whichever sweep polls first, so a fresh call can overtake one that has waited minutes. Fine for batch throughput; it does mean an individual job's p99 is unbounded under sustained saturation.

**Per-family circuit breakers.** The breaker stays route-scoped, so a genuine 5xx storm on a route affects both the text and image model families. Defensible — 5xx really is endpoint-level — but a per-family breaker would decouple them.

---

## 6. Open, by choice

**Correctness / robustness**

- Modal calls ([segmenting.handler.ts](../services/ingestion-automated/src/steps/segmenting.handler.ts), [placement.handler.ts](../services/ingestion-automated/src/steps/placement.handler.ts)) still read URLs from bare `process.env` with no retry, timeout, or governor. Relatedly, both states are excluded from boot recovery, so a job that dies in `segmenting` *while Modal also fails* needs a dashboard restart.
- A spend-cap 429 is classified as an ordinary rate limit — 15 s pause, retry, repeat — for a condition that cannot clear until a human raises the cap. Skipping the route for the run and logging loudly would save pointless probing and name the real cause.

**Observability**

- Nothing watches AI Studio spend, now that it is a live paid lane with a monthly cap. A batch leaning on the fallback route can quietly consume the month's allowance.
- Per-route cost and 429 breakdown in the dashboard; the data is already persisted on artifacts.

**Throughput (Fix 3)**

- SigLIP batching, parallel image downloads, enrichment via the Gemini Batch API.
- Batch VTON as an economy lane — see [economy-lane-batch-vton.md](economy-lane-batch-vton.md).

# Economy Lane — Batch VTON

**Status: built, live-tested, benchmarked (2026-08-18/19).**
99 images across three real sheets: 100% success, 0 fallbacks, 0 refusals, exactly 50% of interactive VTON cost.
Bottom line: **a ~25-row sheet finishes in ~20 minutes at half the VTON cost**, vs ~10 minutes at full price through the instant lane.

---

## 1. What it is

VTON (try-on image generation) is the pipeline's biggest cost: **$0.134/image** through the interactive Gemini API. Google sells the same model, same quality, same 2K output at **half price** through the AI Studio Batch API — you submit a bundle of requests, results come back minutes to hours later (24h SLA, observed 3–18 min).

The economy lane routes the VTON step of opted-in jobs through that API. Everything else — scraping, identification, summary, segmentation, placement — is unchanged and per-job.

Opt-in is per sheet: an **"Economy mode" toggle** on the Excel upload dialog, default off. It sets `vton_lane: 'batch'` on each row's `POST /jobs`. Single submissions and untoggled sheets stay `'instant'` — the server defaults that way, so no caller can batch by accident.

## 2. Why AI Studio batch (settled — do not revisit)

| Option | Verdict | Reason |
|---|---|---|
| **AI Studio batch** | **chosen** | 2K output verified live. $0.067/image on `gemini-3-pro-image` (1K and 2K billed the same) |
| Vertex batch | rejected | hard cap at 1K image output; our catalogue image is 2K |
| OpenRouter batch | rejected permanently | text-only; rejects `image_config` at validation |

AI Studio spends real money from the prepay balance. The **monthly spend cap** is the operational risk: hitting it returns a 429 that looks exactly like a rate limit. The collector detects the cap by message text, stops submitting, and logs loudly (this exact ambiguity once silenced the interactive route for a full day).

## 3. Architecture

Batch is a **station, not a pipeline mode**. A job travels the normal pipeline, pauses at one bus stop, and continues normally afterwards.

```
scrape → identify → summary ──┬─ instant lane ──→ generating_vton ──→ segmenting → …
                              │   (default)          (per-job call)
                              │
                              └─ batch lane ─────→ vton_batch_queued        ← parked, inert
                                                        │
                          COLLECTOR (cron */5) ─ claims ≥20 parked jobs, or any job
                                                 waiting >600s, into ONE tray
                                                        │
                                                 gemini_batches row → Google Batch API
                                                        │  (renders whole tray in parallel)
                          POLLER (cron */3) ──── fetches results, matches each to its
                                                 job by job_id, saves image, un-parks
                                                        │
                                                        └──→ segmenting → …  (normal from here)
```

### Components

| Piece | File | Job |
|---|---|---|
| Protocol helpers | `src/adapters/gemini-batch.protocol.ts` | pure functions: status mapping, correlation, item classification, flush decision, spend-cap detection. No config/network — fully unit-tested |
| Batch client | `src/adapters/gemini-batch.ts` | create/get/cancel trays, Files API upload/download, `BatchSpendCapError` |
| Shared request builder | `src/adapters/vton/vton-request.ts` | the ONE place a VTON prompt/request is built. Both lanes use it; golden-hash tests pin byte-identical prompts |
| Tray data layer | `src/domain/gemini-batches.ts` | every fate-deciding write is a single conditional UPDATE |
| Collector | `src/orchestration/vton-batch-collector.ts` | claims parked jobs, builds the tray, submits |
| Poller | `src/orchestration/vton-batch-poller.ts` | applies results, sweeps stragglers, janitor, 48h deadline |
| Shared persist | `src/steps/persist-vton-result.ts` | both lanes write identical `vton_image` artifacts |
| Schedules | `src/queue/vton-batch-schedules.ts` | crons registered inside `registerWorkers` (survive pg-boss restarts) + one boot pass |
| Ops routes | `src/api/routes/vton-batch.ts` | `GET /vton-batches`, `POST /vton-batches/unpark`, `POST /vton-batches/:id/cancel` |

### Database (migration `20260818180000_add_vton_batch_lane.sql`, applied)

- `ingestion_pipeline_jobs.vton_lane` — `'instant'` (default) or `'batch'`
- `ingestion_pipeline_jobs.gemini_batch_id` — which tray currently owns the job; NULL = unclaimed
- new state `'vton_batch_queued'` in the `current_state` CHECK
- table `gemini_batches` — one row per tray: provider name, status (`submitting → pending → running → succeeded/failed/expired`), request/fallback counts, timestamps
- partial indexes on parked jobs, claimed jobs, open trays

## 4. How one job flows

1. **Fork.** After garment summary, the state machine sends the job to `vton_batch_queued` — only if `vton_lane='batch'` **and** the provider is Gemini (a FASHN-pinned job never parks; the collector only builds Gemini requests).
2. **Parked = inert.** No queue message is sent (`NO_ENQUEUE_STATES`). The dispatcher skips it, the reaper excludes it, boot recovery leaves it alone. Nothing in this service can touch a parked job.
3. **Collect.** Each cron tick asks: are ≥`MIN_FILL` jobs parked, or has the oldest waited >`MAX_WAIT`? If neither, hold. If yes: open a `gemini_batches` row in `'submitting'`, **claim jobs atomically** (`UPDATE … WHERE gemini_batch_id IS NULL … FOR UPDATE SKIP LOCKED`), build one request per job, submit all as one batch, then record the provider name. Trays claim across sheets — parcels don't care which truck.
4. **Build.** Per request: avatar by Files API `fileUri` (uploaded once, cached ~42h against the 48h expiry), garment image inline, prompt from the shared builder, `metadata: { job_id }`. A job whose garment fetch fails is demoted to the instant lane alone — never aborts the tray.
5. **Render.** Google renders the whole tray in parallel. We poll every 3 min.
6. **Apply.** When the tray is terminal: for each result, match by `job_id` (never by position), save the image + artifact (`route_used: 'batch:ai_studio'`, real token usage), then advance the job with a guarded UPDATE. Refused/failed items are demoted to the instant lane, where the existing failover walk takes over. After all items: sweep — any member still parked is demoted. **Only then** is the tray's terminal status written.
7. **Resume.** The advanced job is enqueued with the correct target state, so a Modal segmentation gets the Modal timeout (5400s), not the fast queue's 1800s.

## 5. Safety properties (each one fired live at least once)

- **Claim-first ordering.** The tray row exists before any job is claimed, and jobs are claimed before Google is called. A crash before submission leaves a recognisable orphan (`'submitting'`, no provider name) that the janitor releases after 15 min — zero spend, double-submit impossible. This matters because **batch creation is not idempotent**.
- **Correlation by value, never position.** `job_id` rides in `metadata` and comes back on each result. Results can be missing, unordered, or carry per-item errors; none of that can misroute an image.
- **Ownership guard.** Applying a result is one conditional UPDATE: the row must still be parked AND still owned by this tray. Zero rows → log and discard. Covers: repeated ticks after a crash, a job restarted while its tray was out, a deleted job. A stale result can never double-drive a job.
- **Artifact first, state second.** A crash between the two leaves a parked job that already owns its image — the next tick completes it idempotently. The reverse order would leave an advanced job with no image.
- **Apply before terminal.** The tray's status is written only after every result is applied and stragglers swept. A crash mid-application leaves the row `'running'`; the next tick redoes it harmlessly. (Verified live: a service restart landed mid-application and the run completed correctly.)
- **Every terminal outcome sweeps.** Succeeded-with-missing-items, failed, expired, cancelled — members never stay parked behind a dead tray.
- **48h self-expiry.** Google expires trays at 48h; the poller also self-expires by clock in case the provider is unreachable.
- **Restart semantics.** Restarting a job always releases its tray claim (makes late results harmless) but only flips it to the instant lane if it was actually parked — a job that failed upstream keeps its economy lane on retry.
- **Kill switch drains, never strands.** `VTON_BATCH_ENABLED=false` stops the collector only; poller/janitor keep running until every in-flight tray is resolved.
- **Reuse guard.** The instant handler skips generation if a `vton_image` artifact already exists — a batch image is never paid for twice.

## 6. Operations

### Env (service `.env`)

```
VTON_BATCH_ENABLED=true
VTON_BATCH_MODEL=gemini-3-pro-image        # pinned by the spike; 2K verified in batch
VTON_BATCH_FLUSH_SIZE=30                   # hard cap per tray
VTON_BATCH_MIN_FILL=20                     # ship when this many are parked…
VTON_BATCH_MAX_WAIT_SECONDS=600            # …or when the oldest has waited this long
VTON_BATCH_FLUSH_CRON=*/5 * * * *          # a tick is permission to CONSIDER a tray,
VTON_BATCH_POLL_CRON=*/3 * * * *           # never an instruction to send one
```

`MIN_FILL=1` restores ship-on-every-tick if ever wanted. Related: `FIRECRAWL_MAX_CONCURRENCY=3` gates scraping (a real semaphore since 2026-08-19); text summaries run `gemini-3.6-flash` primary with `3.5-flash, flash-latest` fallbacks.

### Endpoints

- `GET /vton-batches` — lane status: enabled, parked count, open trays with age + stale flag
- `POST /vton-batches/unpark` — bulk-move all **unclaimed** parked jobs back to the instant lane (claimed jobs are already paid for; the poller resolves them)
- `POST /vton-batches/:id/cancel` — cancel a tray at Google (best-effort) and release its claims

### Reading the logs

- `holding — tray not full…` every flush tick = normal accumulation
- `flushing a batch tray` with `trigger: full|max-wait` = tray going out
- `batch tray state changed at Google` = the only line during the render wait; silence between these lines means "rendering", not "dead"
- `batch result applied` per image; `swept parked members` = something fell back
- `AI STUDIO SPEND CAP` at error level = stop and check billing, do not retry

### Provider limits (reference)

20 MB inline request ceiling · 2 GB file path · **100 concurrent batch jobs** · 48h job expiry · Files API objects live 48h · enqueued-token ceilings per model (Tier 1: 2M for `gemini-3-pro-image`). Avatar by `fileUri` is what makes inline viable: a 30-job tray is ~2 MB by reference vs ~89 MB inlined (only ~6 jobs fit inlined).

## 7. Benchmarks (measured, 2026-08-18/19)

### The three runs

| Run | Rows | Trays | Wall-clock | Notes |
|---|---|---|---|---|
| batch_148 | 24 | 7 (4+2+2+1+2+14+2) | hours¹ | found the flush-trigger gap, drip feeder, dead Firecrawl limiter |
| batch_149 | 25 | 3 (13+13+2²) | 29 min | old feeder split the sheet; age trigger verified |
| **batch_150** | **21** | **1 (21)** | **21.3 min** | the corrected stack |

¹ dominated by two mid-run service restarts (`bun --watch` orphans in-flight handlers for up to 30 min) — not the lane.
² carried batch_148's straggler: trays claim cross-sheet by design.

### Tray economics

Google turnaround is **per tray, not per image**, and queue variance dominates size — two identical 13-trays took 435s and 1088s. Observed band: **170–1088s (3–18 min)**. Build time is noise (7–16s at any size). Bigger trays amortize better:

| Tray size | Google | Per image |
|---|---|---|
| 1 | 294s | 294s |
| 14 | 734s | 52s |
| **21** | **454s** | **21.6s** |

### batch_150 detail (the reference run)

```
feed          4.6s   (all 21 rows submitted up front)
upstream      ~13.5 min  (scrape ~5–6 min of it, gated at 3 concurrent)
fill line     crossed at T0+11:41 (20 parked)
tray          one, 21 requests, built in 16s
google        454s
TOTAL         21.3 min  ·  49,346 metered tokens  ·  $1.41 vs $2.81 interactive
```

The plan priced a refusal tax of 1–2 in 8. Measured: **0 refusals in 99 images** — realised savings are the full 50%, better than the design's own estimate.

## 8. Bugs found by live testing

1. **No flush trigger** (design gap, not just code). Flush size was only a cap; every cron tick shipped whatever was parked → trays of 1–2. Fixed with fill-or-age (`shouldFlushTray`, unit-tested).
2. **Restart downgraded the lane unconditionally.** Bulk retries of economy rows that failed *upstream* were silently re-billed at full price. Now the claim always releases, but the lane only flips when the job was actually parked.
3. **Pre-existing: re-submitting a URL whose job had failed returned HTTP 500** (dedupe_key held forever, raw constraint error leaked). Now a 409 naming the previous job.
4. **The frontend drip-feeder.** `useBulkIngest` submitted 3 rows at a time and waited for each trio to settle — a client-side throttle from before the queue existed. It starved the backend and trickled rows past max-wait, splitting sheets into small trays. Both modes now flood-feed; the backend's `teamSize` is the concurrency governor. `vton_batch_queued` also joined the runner's settled set (without it, economy mode deadlocked the runner at row 4).
5. **`FIRECRAWL_MAX_CONCURRENCY` was dead code** — defined, set, consumed nowhere; the drip-feeder masked it. Now a real semaphore in the Firecrawl adapter.
6. **pg-boss teams without `teamRefill: true`** stall on their slowest member. Fixed in `worker.ts`.

Also fixed along the way: silent poller (now logs tray state changes), cost accounting (batch artifacts priced at the 0.5× rate; usage-less images at a flat fallback instead of $0), status dialog (economy rows shown as "Queued at Google", not folded into "still running" where they look frozen).

## 9. Remaining work

- **Male avatar re-encode** — 12.5 MB (JPEG bytes in a `.png`), works by `fileUri` but pays upload cost on every cache refresh. Re-encode to ~2 MB **preserving exact pixel dimensions** (placement lattices are pixel-based). Replaces the file for both lanes → one-time output shift for the instant lane; needs a deliberate go-ahead.
- **Failure drills** — scripted (poison URL / restart-mid-tray / force-expire / spend-cap) but unrun. The mechanisms they test all fired incidentally during live runs, but the drills are the controlled versions.
- **Instant-lane `safetySettings`** — the instant adapter sends none today; the spike passed relaxed settings in batch without issue. Adopting them in either lane is a live-output change; decide deliberately.
- **Webhooks** — `webhookConfig` on batch creation would replace the poller cron entirely once the service has public ingress.

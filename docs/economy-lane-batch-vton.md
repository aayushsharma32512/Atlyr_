# Bulk Ingestion — How It Runs

Covers the whole bulk path: the queue and workers, what happens when a step fails, the background
sweeper that unsticks jobs, and the economy (batch) VTON lane.

**Status:** live, tested on real sheets. Last full run 2026-08-25 — 121 rows across six sheets,
**zero jobs failed**.

---

## 1. The flow

One sheet of product URLs goes in. Every row becomes a job, and every job walks the same steps.

```
Excel sheet ──► POST /batches ──► one job row per URL
                                        │
                                        ▼
   ┌──────────────────── FAST QUEUE (12 slots) ────────────────────┐
   │  scrape ──► identify ──► garment summary ──► try-on (VTON)    │
   └───────────────────────────────────────────────────────────────┘
                                        │
   ┌──────────────────── MODAL QUEUE (5 slots) ────────────────────┐
   │  segment ──► place                                            │
   └───────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
                                    completed
```

Two things can interrupt that walk:

- **A human gate.** With HITL on, the job stops at `awaiting_hitl_identification` or
  `awaiting_hitl_segmentation` until someone clicks Proceed.
- **The economy lane.** If the sheet was submitted with Economy mode on, the try-on step parks at
  `vton_batch_queued` instead of calling Gemini per job. See section 5.

Everything else is unchanged per job.

---

## 2. Workers and queues

**Two queues, one handler.** Fast steps and GPU steps have separate slot pools, so a pile-up of
multi-minute segmentation waits cannot starve scraping.

| Queue | Steps | Slots | Step timeout |
|---|---|---|---|
| Fast | scrape, identify, summary, try-on | `BOSS_TEAM_SIZE=12` | 1800s |
| Modal | segment, place | `BOSS_MODAL_TEAM_SIZE=5` | 5400s |

The handler is the same for both. `dispatch()` reads `current_state` from the database, so which
queue delivered the message never decides what runs.

**`teamRefill: true` is load-bearing.** pg-boss v9 with a bare `teamSize` grabs a batch of jobs and
will not fetch again until the *whole batch* finishes. One slow handler — a try-on call walking the
model fallback chain can legitimately take 10+ minutes — then stalls the entire queue behind it.
`teamRefill` refills each slot as its own member finishes. This was a real stall, not a theoretical
one.

**Scraping is the front bottleneck.** Firecrawl is capped at `FIRECRAWL_MAX_CONCURRENCY=6`
concurrent scrapes — a real semaphore in the adapter. It used to be dead config: defined, set,
consumed nowhere. With 12 worker slots and 6 scrape slots, rows queue at the front and then fan out.
Free workers were never the limit; scrape slots were.

---

## 3. When a step fails

The old behaviour: any error → mark the job `failed`, rethrow. That is right for a bad URL and wrong
for a rate limit.

It cost 15 jobs on 2026-08-23. Worse, the three pg-boss retries that followed did nothing — `failed`
is terminal, so every retry returned at the terminal-state guard without running anything.

**The rule now: a wait is not a verdict.**

```
step throws
    │
    ├─ bad URL, retired model, malformed request  ──► FAIL now. Waiting cannot fix it.
    │
    ├─ all upstream slots busy (backpressure)     ──► retry, FREE (no attempt charged)
    │
    └─ rate limit / transient upstream            ──► retry, charged (max 5 attempts)
```

**Backpressure is free, and that matters.** "All 6 Firecrawl slots are in use" says nothing about
this job's chances — it is queue position, not failure. Charging it killed 9 rows of `batch_158` in
about 25 seconds. The adapter now tells the two apart:

| Adapter reports | Meaning | Charged? |
|---|---|---|
| `saturated` | our own slots are full, others are working | **no** |
| `paused` | the key is rate limited or out of credits | yes |

Backpressure resolves on its own: slots free as the jobs holding them finish. The attempt cap still
exists to stop a genuinely dead upstream — a revoked key, a dead endpoint — from cycling jobs forever
with no failure ever surfacing in the UI.

**Retry delay** comes from the server when it names one, otherwise 60s.

**402 (out of credits) is deliberately fast-failed.** It is not a bad request — the URL and garment
were fine, the key ran out of money. But treating it as a rate limit would burn all 5 attempts in
five minutes on something that needs hours. So it fails, the operator sees a dead key, and the
custodian retries it later on a much slower clock. The Firecrawl adapter also parks that key for
6 hours.

---

## 4. The custodian (background sweeper)

Every wait in the pipeline now has an owner. Before this, three rescue paths existed and none ran at
steady state:

- boot recovery only ran at boot — a row stranded while the service stayed up was never looked at again
- the reaper also only ran at boot, and defaulted to log-only, so it had never actually acted
- `segmenting` and `placement` were excluded from both, correctly, because Modal patches state out
  of band — but nothing else bounded them either. If the container died, the row sat there forever.

The custodian runs on a cron (`*/5`) and does four passes, in order:

| # | Pass | What it does |
|---|---|---|
| 1 | Resume orphans | Re-dispatches rows whose worker died mid-step |
| 2 | Modal deadline | Fails rows stuck in `segmenting`/`placement` past 5400+300s **with no live run behind them** |
| 3 | Reap | Fails long-abandoned rows in states this worker drives start to finish |
| 4 | Auto-retry | Retries failures that were about *conditions*, not about the job |

Details that matter:

- **Pass 2 fails, it does not re-dispatch.** The Modal app writes `segmentation_jobs` itself and the
  handler deletes the existing row before inserting — re-dispatching against a container that is
  somehow still alive would wipe the record of the live run. Failing surfaces it in the UI where a
  human decides.
- **Pass 4 does not reset `error_count`.** That is what bounds the loop. The custodian only ever
  spends the existing budget; a human restart grants a fresh one. It also waits 30 minutes before
  touching anything — retrying instantly would fight the operator looking at the job and re-ask an
  upstream that is still broken.
- **Each pass is independent.** One failing pass cannot stop the other three, and none can take the
  service down.
- **`singletonKey`** stops two ticks, or two service instances, reaping the same rows at once.
- Registered inside `registerWorkers`, not once at startup — otherwise a pg-boss restart leaves the
  persisted schedule emitting ticks with nobody working them, silently.

---

## 5. The economy lane (batch try-on)

Try-on is the pipeline's biggest cost: **$0.134/image** through the interactive Gemini API. Google
sells the same model, same quality, same 2K output at **half price** through the AI Studio Batch API
— you submit a bundle, results come back minutes to hours later.

Opt-in is **per sheet**: an "Economy mode" toggle on the Excel upload, default off. Single
submissions and untoggled sheets stay instant. The server defaults to instant too, so nothing can be
batched by accident.

Batch is a **station, not a mode**. The job walks the normal pipeline, pauses at one bus stop, and
continues normally afterwards.

```
… summary ──┬─ instant (default) ──► try-on, one call per job ──► segment …
            │
            └─ economy ──► vton_batch_queued          (parked, inert)
                                 │
             COLLECTOR (*/5) ── claims 20+ parked jobs, or any job waiting
                                over 600s, into ONE tray (max 30)
                                 │
                                 ├──► Google Batch API — renders the tray in parallel
                                 │
             POLLER (*/3) ────── matches each result to its job by job_id,
                                 saves the image, un-parks
                                 │
                                 └──► segment …   (normal from here)
```

**Parked means inert.** No queue message exists for a parked job. The dispatcher skips it, the
reaper excludes it, boot recovery leaves it alone. Nothing in this service can touch it.

### Why AI Studio batch (settled — do not revisit)

| Option | Verdict | Reason |
|---|---|---|
| **AI Studio batch** | **chosen** | 2K output verified live, $0.067/image (1K and 2K billed the same) |
| Vertex batch | rejected | hard cap at 1K output; our catalogue image is 2K |
| OpenRouter batch | rejected | text-only; rejects `image_config` at validation |

### Safety rules (each one fired live at least once)

- **Claim first, then call Google.** The tray row exists before any job is claimed, and jobs are
  claimed before submission. A crash before submission leaves a recognisable orphan the janitor
  releases after 15 min — zero spend, no double-submit. Batch creation is not idempotent, so this
  ordering is the whole safety argument.
- **Match by `job_id`, never by position.** Results can come back missing, unordered, or with
  per-item errors. None of that can misroute an image.
- **Ownership guard on apply.** One conditional UPDATE: the row must still be parked *and* still
  owned by this tray. A stale result can never double-drive a job.
- **Image first, state second.** A crash between the two leaves a parked job that already owns its
  image; the next tick finishes it. The reverse would leave an advanced job with no image.
- **Apply everything before marking the tray terminal.** A crash mid-apply leaves the tray
  `running` and the next tick redoes it harmlessly.
- **Every terminal outcome sweeps.** Succeeded-with-missing, failed, expired, cancelled — members
  never stay parked behind a dead tray.
- **48h self-expiry**, in case Google is unreachable.
- **Kill switch drains.** `VTON_BATCH_ENABLED=false` stops the collector only; the poller keeps
  running until every in-flight tray resolves.
- **Reuse guard.** The instant handler skips generation if a try-on image already exists, so a batch
  image is never paid for twice.
- **Restart keeps the lane.** Restarting a job always releases its tray claim, but only flips it to
  instant if it was actually parked — a job that failed *upstream* keeps its economy lane.

### Files

| Piece | File |
|---|---|
| Protocol helpers (pure, unit-tested) | `adapters/gemini-batch.protocol.ts` |
| Batch client | `adapters/gemini-batch.ts` |
| Shared request builder (both lanes) | `adapters/vton/vton-request.ts` |
| Tray data layer | `domain/gemini-batches.ts` |
| Collector / poller | `orchestration/vton-batch-{collector,poller}.ts` |
| Shared persist | `steps/persist-vton-result.ts` |
| Schedules | `queue/vton-batch-schedules.ts` |
| Ops routes | `api/routes/vton-batch.ts` |

Migration `20260818180000_add_vton_batch_lane.sql` — adds `vton_lane`, `gemini_batch_id`, the
`vton_batch_queued` state, the `gemini_batches` table, and partial indexes.

---

## 6. Settings

Service `.env`:

```
BOSS_TEAM_SIZE=12                  # fast-queue slots
BOSS_MODAL_TEAM_SIZE=5             # GPU-queue slots (default)
BOSS_STEP_TIMEOUT_SECONDS=1800     # how long a fast step may run
BOSS_MODAL_STEP_TIMEOUT_SECONDS=5400
FIRECRAWL_MAX_CONCURRENCY=6        # real semaphore; the front bottleneck

STEP_MAX_ATTEMPTS=5                # charged attempts before a job fails for good
STEP_RETRY_FALLBACK_SECONDS=60     # delay when the server names none

CUSTODIAN_ENABLED=true             # defaults
CUSTODIAN_CRON=*/5 * * * *
AUTO_RETRY_FAILED=true
AUTO_RETRY_MIN_IDLE_SECONDS=1800   # wait 30 min before auto-retrying a failure
AUTO_RETRY_MAX_ATTEMPTS=5
REAPER_MODE=fail
BOOT_RECOVERY=resume

VTON_BATCH_ENABLED=true
VTON_BATCH_MODEL=gemini-3-pro-image
VTON_BATCH_FLUSH_SIZE=30           # hard cap per tray
VTON_BATCH_MIN_FILL=20             # ship when this many are parked...
VTON_BATCH_MAX_WAIT_SECONDS=600    # ...or when the oldest has waited this long
VTON_BATCH_FLUSH_CRON=*/5 * * * *  # a tick is permission to CONSIDER a tray,
VTON_BATCH_POLL_CRON=*/3 * * * *   # never an instruction to send one
```

Text summaries run `gemini-3.6-flash` primary, with `3.5-flash` and `flash-latest` as fallbacks.

### Endpoints

- `GET /vton-batches` — lane status: parked count, open trays with age and stale flag
- `POST /vton-batches/unpark` — move all **unclaimed** parked jobs back to instant. Claimed ones are
  already paid for; the poller resolves them.
- `POST /vton-batches/:id/cancel` — cancel a tray at Google, release its claims

### Reading the logs

| Line | Means |
|---|---|
| `holding — tray not full…` | normal accumulation |
| `flushing a batch tray` + `trigger` | tray going out |
| `batch tray state changed at Google` | the only line during the render wait — silence means rendering, not dead |
| `batch result applied` | one image landed |
| `swept parked members` | something fell back to instant |
| `every key declined this request — deferring` | backpressure, the job is fine |
| `custodian tick` | the sweeper did something |

---

## 7. Numbers

### Sheet turnaround

| Run | Rows | Trays | Wall-clock | Note |
|---|---|---|---|---|
| batch_148 | 24 | 7 | hours | found the flush gap, drip feeder, dead scrape limiter |
| batch_149 | 25 | 3 | 29 min | old feeder split the sheet |
| **batch_150** | **21** | **1** | **21.3 min** | the corrected stack, reference run |

`batch_150` detail: feed 4.6s, upstream ~13.5 min (scrape ~5–6 of it), fill line crossed at
T0+11:41, one tray of 21 built in 16s, Google 454s. **$1.41 vs $2.81 interactive.**

The plan priced a refusal tax of 1–2 in 8. Measured: **0 refusals in 99 images** — the full 50%
saving, better than the design's own estimate.

### Tray turnaround depends on how many trays are in flight

Google's turnaround is **per tray, not per image**. Measured 2026-08-25:

| Trays in flight | Tray sizes | Turnaround |
|---|---|---|
| 3 | 12 / 30 / 20 | **68 / 67 / 56 min** |
| 1–2 | 25 / 30 / 4 | **19 / 15 / 6 min** |

This is new and it matters: earlier benchmarks (170–1088s, i.e. 3–18 min) only ever covered **one
tray at a time**. Three concurrent trays cost roughly an hour each. Do not plan capacity off the
single-tray band.

Bigger trays still amortize better — tray of 1 = 294s/image, 14 = 52s, 21 = 21.6s.

### Reliability, 2026-08-25

Counted from the job table across all six sheets:

| | |
|---|---|
| Jobs | **121** |
| Failed | **0** |
| Finished without ever being charged an attempt | 100 |
| Took at least one charged deferral | 21 |
| Worst `error_count` on any job | 2 |

All 121 ended in `awaiting_hitl_segmentation` — the review queue — which is the expected resting
place with HITL on.

The kinds of trouble they hit and survived (counts here are from the logs, not the table above):

- **Pure backpressure** — all Firecrawl slots busy. The most common wait by far, and charged
  nothing. This is the exact shape that killed 9 jobs before the cap exemption.
- **Firecrawl keys genuinely paused** — rate limited or out of credits. Charged, and recovered.
- **Storage socket drops** — a Supabase blip, nothing to do with rate limits. Classified transient,
  deferred 60s, **all recovered**. Under the old code every one would have been terminally `failed`.
- **Scrape timeouts (408)** — recovered.
- **One try-on fell back to `vertex:global`** (58 went through `batch:ai_studio`). First time the
  fallback path has fired live; it worked.

**What the run taught that the design did not:**

- The retry fix generalises past its own motivation. It was built for rate limits; the failure it
  actually caught in production was a storage socket drop. The invariant is not "handle 429" — it is
  *a wait is not a verdict*.
- `hasPendingArrivals()` being global is load-bearing. A small sheet only gets the early-ship
  shortcut when the pipeline is otherwise idle; another sheet upstream correctly suppresses it,
  because more genuinely *is* coming.
- Duplicates are **dropped, never substituted**. A 25-row sheet with 3 repeats produces 22 jobs.

---

## 8. Bugs live testing found

1. **No flush trigger.** Flush size was only a cap; every tick shipped whatever was parked, so trays
   came out at 1–2. Now fill-or-age, unit-tested.
2. **Restart downgraded the lane unconditionally.** Economy rows that failed *upstream* were
   silently re-billed at full price on retry.
3. **Re-submitting a URL whose job had failed returned HTTP 500** — the dedupe key was held forever.
   Now a 409 naming the previous job.
4. **The frontend drip-feeder.** `useBulkIngest` submitted 3 rows at a time and waited for each trio
   to settle — a client-side throttle from before the queue existed. It starved the backend and
   split sheets into small trays. Both modes now flood-feed; the backend is the governor.
5. **`FIRECRAWL_MAX_CONCURRENCY` was dead code.** Defined, set, consumed nowhere — masked by the
   drip-feeder. Now a real semaphore.
6. **pg-boss teams without `teamRefill`** stall on their slowest member.
7. **A rate limit was terminal.** Cost 15 jobs on 2026-08-23. See section 3.
8. **Backpressure was charged against the retry cap.** Killed 9 rows of `batch_158` in ~25s.
9. **Boot recovery re-dispatched parked jobs**, which the economy lane must never allow.
10. **Modal states had no deadline at all.** If the GPU container died, the row sat forever.

Also fixed: silent poller (now logs tray state changes), cost accounting (batch artifacts priced at
0.5x, usage-less images at a flat fallback instead of $0), and the status dialog (economy rows show
as "Queued at Google" rather than folded into "still running", where they looked frozen).

---

## 9. Still open

- **Tray concurrency is measured but not explained.** We know three trays cost roughly an hour each;
  we do not know whether that is Google queueing us against ourselves or ordinary variance. Bounded
  by the 6h stale warning and the 48h self-expiry, but not understood.
- **`already_ingested` dedupe is unproven.** Jobs stop at `awaiting_hitl_segmentation` under HITL,
  so nothing reaches `completed` and that branch never runs. Needs a job pushed through Go Live.
- **The 48h tray deadline and the Modal deadline sweep have never fired in anger.**
- **Male avatar re-encode** — 12.5 MB (JPEG bytes in a `.png`). Works by `fileUri` but pays upload
  cost on every cache refresh. Re-encode to ~2 MB **preserving exact pixel dimensions**, since
  placement lattices are pixel-based. Affects both lanes; needs a deliberate go-ahead.
- **Instant-lane `safetySettings`** — the instant adapter sends none; the spike passed relaxed
  settings in batch without issue. Adopting them either way is a live-output change.
- **Webhooks** would replace the poller cron entirely once the service has public ingress.
- **Drill gap:** drill 1 asserts `recovery-scope.ts`, not `boot-recovery.ts`'s use of it. If someone
  re-declares a local list in that file the drill will not notice.

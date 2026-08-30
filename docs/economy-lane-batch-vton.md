# Bulk Ingestion

Everything about how a bulk sheet gets processed: workers, queues, retries, the background
supervisor, and the economy (batch) try-on lane.

**Status:** live and tested. Last full run 2026-08-25, 121 rows across six sheets, **zero jobs
failed**.

---

## 1. The basics

Think of it as a small factory.

**A job** is one product URL. It has to get through six steps:

```
scrape  ->  identify  ->  garment summary  ->  try-on  ->  segment  ->  place
```

**A worker** is one slot that runs one step for one job at a time. We have 12 of them.

**A queue** is the waiting list. Workers pick the next job off it, run one step, then put the job
back on the queue for its next step.

So 12 workers means 12 steps can be running at the same moment, on 12 different jobs. A sheet of 25
rows does not run one row at a time. It runs up to 12 at a time, and each row moves through the
steps independently.

Nobody holds a worker while waiting. If a job has to wait for something, it lets go of its worker so
someone else can use it.

---

## 2. The flow

```
Excel sheet  ->  POST /batches  ->  one job row per URL
                                          |
                                          v
   +------------------ FAST WORKERS (12) ------------------+
   |  scrape  ->  identify  ->  summary  ->  try-on        |
   +-------------------------------------------------------+
                                          |
   +------------------ GPU WORKERS (5) --------------------+
   |  segment  ->  place                                   |
   +-------------------------------------------------------+
                                          |
                                          v
                                      completed
```

Two things can pause a job on the way:

1. **A human gate.** With HITL turned on, the job stops and waits for someone to click Proceed.
   Today most sheets stop at `awaiting_hitl_segmentation`, which is the review queue.
2. **The economy lane.** If the sheet was uploaded with Economy mode on, the try-on step waits to be
   bundled with other jobs instead of being done one at a time. See section 7.

---

## 3. Why there are two groups of workers

Four of the six steps are fast, usually seconds to a couple of minutes. Two of them (segment and
place) run on a GPU and can take many minutes.

If they all shared one pool, a pile of slow GPU steps would occupy every worker and the fast steps
would starve behind them.

So there are two separate pools:

| Pool | Steps | Workers | Longest a step may run |
|---|---|---|---|
| Fast | scrape, identify, summary, try-on | 12 | 30 min |
| GPU | segment, place | 5 | 90 min |

Both pools run the same code. The job's own `current_state` in the database decides what actually
runs, so it never matters which pool picked the job up.

### The stall we hit: workers waiting on each other

The queue library (pg-boss) by default hands a pool a whole batch of jobs at once, and will not hand
out a single new job until **every job in that batch has finished**.

So if 11 jobs finish in 30 seconds and the 12th takes 10 minutes, those 11 workers sit idle for 10
minutes. The queue looks busy while almost nothing is happening.

A try-on call walking its model fallback chain can legitimately take 10+ minutes, so this was not
rare.

The setting `teamRefill: true` fixes it. Each worker takes a new job the moment its own job
finishes, instead of waiting for the group.

---

## 4. Slots, and what backpressure actually means

This is the part that confuses people, so slowly.

Our 12 workers are ours. But the outside services we call have their own limits, and those limits
are separate.

**Firecrawl** (the scraping service) only lets us run **6 scrapes at the same time**. Call those 6
"scrape slots".

So the real picture during the scrape phase of a sheet:

```
12 workers all want to scrape
   |
   +-- 6 of them get a scrape slot and start working
   |
   +-- 6 of them find every slot taken, and have to wait
```

**Backpressure is that second group.** It means nothing more than: *everyone else is using the
resource right now, wait your turn.*

Nothing is wrong with those jobs. Their URLs are fine. They just arrived 7th through 12th in line.

### The bug this caused

Every job gets **5 strikes**. Five failures and we give up on it and mark it `failed`.

We used to count "all slots busy" as a strike.

So a job whose only crime was being 9th in line burned all 5 strikes in about 25 seconds and got
killed. That is firing someone for standing in a queue. It killed 9 rows of `batch_158`.

**The fix: waiting your turn costs no strike.** Only real problems cost strikes.

### How we tell the difference

The scraping adapter now reports two different things:

| What it reports | What it means | Costs a strike? |
|---|---|---|
| `saturated` | Our own slots are all busy. Other jobs are actively working. They will free up in seconds. | **No** |
| `paused` | The service told us to stop (rate limit), or the key ran out of money. | **Yes** |

The difference matters because they resolve differently. A saturated pool fixes itself as running
jobs finish. A paused key does not fix itself for hours.

We still keep the 5-strike cap, because something genuinely broken (a revoked key, a dead endpoint)
must eventually surface as a failure instead of cycling jobs forever with nobody noticing.

---

## 5. When a step goes wrong

The old rule was: any error at all, mark the job `failed`, done.

That is right for a bad URL. It is wrong for a rate limit, which is not a verdict on the job. It is
a wait with a known length, because the server literally tells us how long to hold off.

It cost 15 jobs on 2026-08-23. Worse, the three automatic retries that followed did nothing at all,
because `failed` is a final state and every retry returned immediately without running anything.

**The rule now: a wait is not a verdict.**

```
step throws an error
    |
    +-- bad URL, retired model, malformed request
    |      -> FAIL now. Waiting cannot fix any of these.
    |
    +-- all slots busy (backpressure)
    |      -> wait and try again. Costs no strike.
    |
    +-- rate limit, or a service that was briefly down
           -> wait and try again. Costs a strike. Max 5.
```

How long it waits: the server's own number if it gave one, otherwise 60 seconds.

### The one odd case: out of credits (402)

An HTTP 402 means the key ran out of money. Technically it is a 4xx, which normally means "your
request was wrong". But the request was fine. The URL, the garment, the prompt were all correct.

We deliberately fail these fast rather than retrying, because retrying every 60 seconds would burn
all 5 strikes in five minutes on something that needs hours or a human topping up the account. So it
fails, an operator sees a dead key in the UI, and the supervisor (next section) tries it again later
on a much slower clock. The scraping adapter also stops using that key for 6 hours.

---

## 6. The custodian (the background supervisor)

Every 5 minutes, a background pass walks the floor looking for jobs nobody is working on.

This exists because the old rescue paths only ran **when the service restarted**. If a job got stuck
while the service kept running normally, nothing ever looked at it again. And the GPU steps had no
deadline at all: if the GPU container died, the job sat in `segmenting` forever, because both
existing rescue paths deliberately skipped those states.

Four passes, in order:

| # | Pass | What it does |
|---|---|---|
| 1 | Resume orphans | A worker died mid-step. Put the job back on the queue. |
| 2 | GPU deadline | Job stuck in segment or place way past its time limit, with nothing actually running behind it. Mark failed. |
| 3 | Reap | Job abandoned for a long time in a step we drive ourselves. Mark failed. |
| 4 | Auto-retry | The job failed for a reason that may have gone away since. Try once more. |

Things worth knowing:

- **Pass 2 marks failed instead of restarting the job.** The GPU app writes its own progress rows,
  and our handler deletes the existing row before inserting a new one. So restarting a job whose
  container is somehow still alive would wipe the record of the live run. Failing puts it in the UI
  where a human decides.
- **Pass 4 does not reset the strike count.** That is what keeps it from looping forever. The
  supervisor only ever spends strikes that are already there. A human clicking Restart grants a
  fresh 5.
- **Pass 4 waits 30 minutes** before touching a failed job. Retrying instantly would fight the
  operator who is looking at it, and would re-ask a service that is probably still broken.
- **Each pass is independent.** One pass breaking cannot stop the other three, and none of them can
  take the service down.
- It uses a lock so two ticks, or two copies of the service, cannot work the same rows at once.

---

## 7. The economy lane (bundled try-on)

Try-on is the most expensive step: **$0.134 per image** through the normal Gemini API. Google sells
the same model, same quality, same 2K output at **half price** if you submit a bundle of requests
and wait for the results instead of asking one at a time.

Turning it on is **per sheet**: an "Economy mode" toggle on the Excel upload, off by default. Single
submissions and untoggled sheets stay on the normal path. The server also defaults to normal, so
nothing can end up bundled by accident.

The important idea: **bundling is a bus stop, not a different route.** The job walks the normal
pipeline, waits at one stop, and carries on normally afterwards.

```
... summary --+-- normal (default) --> try-on, one call per job --> segment ...
              |
              +-- economy --> job waits at vton_batch_queued
                                    |
             COLLECTOR (every 5 min) collects 20+ waiting jobs, or any job
                                    that has waited over 10 min, into ONE tray
                                    (max 30 per tray)
                                    |
                                    +--> sent to Google, whole tray rendered together
                                    |
             POLLER (every 3 min) -- matches each result back to its job by job id,
                                    saves the image, releases the job
                                    |
                                    +--> segment ...   (normal from here)
```

**A waiting job holds no worker.** There is no queue entry for it at all. The dispatcher skips it,
the reaper skips it, restart recovery leaves it alone. This is why waiting in the economy lane costs
us nothing in capacity.

### Why AI Studio batch (settled, do not revisit)

| Option | Verdict | Reason |
|---|---|---|
| **AI Studio batch** | **chosen** | 2K output verified live, $0.067 per image (1K and 2K cost the same) |
| Vertex batch | rejected | caps image output at 1K, our catalogue image is 2K |
| OpenRouter batch | rejected | text only, rejects image config outright |

### The safety rules

Each of these has been exercised live at least once.

- **Claim the jobs before calling Google.** The tray row is created first, jobs are attached to it
  second, Google is called third. If we crash before the call, we leave a recognisable half-made
  tray that gets cleaned up after 15 minutes, having spent nothing. This ordering is the whole
  safety argument, because creating a batch at Google is not repeatable safely.
- **Match results by job id, never by position in the list.** Results can come back missing, out of
  order, or with per-item errors. None of that can put the wrong image on the wrong product.
- **Check ownership before applying a result.** The job must still be waiting AND still belong to
  this tray. A stale result can never drive a job twice.
- **Save the image first, advance the job second.** Crash in between and you get a waiting job that
  already has its image, which the next pass finishes cleanly. The other order would give you an
  advanced job with no image.
- **Apply every result before marking the tray done.** Crash halfway and the tray stays open, and
  the next pass redoes it harmlessly.
- **Every ending sweeps.** Succeeded, failed, expired, cancelled: no job is ever left waiting behind
  a dead tray.
- **The tray expires itself after 48 hours**, even if Google is unreachable.
- **The off switch drains rather than strands.** Turning the lane off stops collecting new trays but
  keeps polling until every tray already at Google is resolved.
- **Never pay twice.** The normal try-on handler skips generation if the job already has an image.
- **Restarting a job keeps its lane** unless it was actually waiting at the bus stop. A job that
  failed earlier in the pipeline stays on economy when you retry it.

### Files

| Piece | File |
|---|---|
| Protocol helpers (pure, unit tested) | `adapters/gemini-batch.protocol.ts` |
| Batch client | `adapters/gemini-batch.ts` |
| Shared request builder (both lanes) | `adapters/vton/vton-request.ts` |
| Tray data layer | `domain/gemini-batches.ts` |
| Collector and poller | `orchestration/vton-batch-{collector,poller}.ts` |
| Shared save | `steps/persist-vton-result.ts` |
| Schedules | `queue/vton-batch-schedules.ts` |
| Ops routes | `api/routes/vton-batch.ts` |

Migration `20260818180000_add_vton_batch_lane.sql` adds the lane column, the tray link, the waiting
state, the `gemini_batches` table and its indexes.

---

## 8. Settings

Service `.env`:

```
BOSS_TEAM_SIZE=12                  # fast workers
BOSS_MODAL_TEAM_SIZE=5             # GPU workers (default)
BOSS_STEP_TIMEOUT_SECONDS=1800     # longest a fast step may run
BOSS_MODAL_STEP_TIMEOUT_SECONDS=5400
FIRECRAWL_MAX_CONCURRENCY=6        # scrape slots. The front bottleneck.

STEP_MAX_ATTEMPTS=5                # strikes before a job is failed for good
STEP_RETRY_FALLBACK_SECONDS=60     # how long to wait when the server names no delay

CUSTODIAN_ENABLED=true             # defaults below
CUSTODIAN_CRON=*/5 * * * *
AUTO_RETRY_FAILED=true
AUTO_RETRY_MIN_IDLE_SECONDS=1800   # wait 30 min before auto-retrying a failed job
AUTO_RETRY_MAX_ATTEMPTS=5
REAPER_MODE=fail
BOOT_RECOVERY=resume

VTON_BATCH_ENABLED=true
VTON_BATCH_MODEL=gemini-3-pro-image
VTON_BATCH_FLUSH_SIZE=30           # hard cap on tray size
VTON_BATCH_MIN_FILL=20             # send when this many are waiting...
VTON_BATCH_MAX_WAIT_SECONDS=600    # ...or when the oldest has waited this long
VTON_BATCH_FLUSH_CRON=*/5 * * * *  # a tick is permission to CONSIDER sending a tray,
VTON_BATCH_POLL_CRON=*/3 * * * *   # never an instruction to send one
```

Text summaries use `gemini-3.6-flash` first, falling back to `3.5-flash` then `flash-latest`.

### Endpoints

- `GET /vton-batches` shows lane status: how many jobs are waiting, which trays are open, how old
- `POST /vton-batches/unpark` moves all **unclaimed** waiting jobs back to the normal lane. Jobs
  already attached to a tray are left alone, because they are already paid for.
- `POST /vton-batches/:id/cancel` cancels a tray at Google and releases its jobs

### Log lines and what they mean

| Line | Meaning |
|---|---|
| `holding` / `tray not full` | Normal. Still collecting. |
| `flushing a batch tray` | A tray is going out. |
| `batch tray state changed at Google` | The only line during the wait. Silence means rendering, not dead. |
| `batch result applied` | One image landed. |
| `swept parked members` | Something fell back to the normal lane. |
| `every key declined this request` | Backpressure. The job is fine, it is waiting its turn. |
| `custodian tick` | The supervisor did something. |

---

## 9. Numbers

### How long a sheet takes

| Run | Rows | Trays | Total time | Note |
|---|---|---|---|---|
| batch_148 | 24 | 7 | hours | found the missing send rule, the drip feeder, the dead scrape limit |
| batch_149 | 25 | 3 | 29 min | old feeder split the sheet |
| **batch_150** | **21** | **1** | **21.3 min** | the corrected stack, reference run |

`batch_150` in detail: feeding all 21 rows in took 4.6 seconds, the pipeline up to try-on took about
13.5 minutes (roughly 5 to 6 of that scraping), the tray filled at 11:41 and was built in 16
seconds, Google took 454 seconds. Cost **$1.41 against $2.81** on the normal lane.

The plan assumed 1 or 2 refusals in every 8 images. Measured: **0 refusals in 99 images**, so the
saving is the full 50%, better than the design's own estimate.

### Tray time depends on how many trays are in flight

Google's turnaround is **per tray, not per image**. Measured 2026-08-25:

| Trays in flight | Tray sizes | Time each |
|---|---|---|
| 3 | 12 / 30 / 20 | **68 / 67 / 56 min** |
| 1 to 2 | 25 / 30 / 4 | **19 / 15 / 6 min** |

This is new and it matters. Every earlier benchmark (170 to 1088 seconds, so 3 to 18 minutes) was
measured with **one tray at a time**. Three trays at once cost roughly an hour each. Do not plan
capacity off the single-tray number.

Bigger trays still spread the cost better: a tray of 1 works out to 294 seconds per image, a tray of
14 to 52 seconds, a tray of 21 to 21.6 seconds.

### Reliability, 2026-08-25

Counted from the job table across all six sheets:

| | |
|---|---|
| Jobs | **121** |
| Failed | **0** |
| Finished without ever taking a strike | 100 |
| Took at least one strike | 21 |
| Worst strike count on any job | 2 |

All 121 ended in `awaiting_hitl_segmentation`, the review queue, which is where they are supposed to
stop with HITL on.

The kinds of trouble they hit and survived (these counts come from the logs, not the table above):

- **Backpressure**, meaning all scrape slots busy. By far the most common wait, and it cost nothing.
  This is the exact situation that used to kill jobs.
- **Keys genuinely paused**, rate limited or out of credits. Cost a strike, and recovered.
- **Storage upload dropped its connection**, a Supabase blip with nothing to do with rate limits.
  Treated as temporary, waited 60 seconds, **all recovered**. Under the old code every one of these
  would have been marked failed permanently.
- **Scrape timeouts (408)**, recovered.
- **One try-on fell back** from the batch route to `vertex:global` (58 went through the batch route).
  First time the fallback has fired live. It worked.

### What the runs taught that the design did not

- **The retry fix turned out broader than its own reason for existing.** It was built for rate
  limits. The failure it actually caught in production was a storage connection drop. The real rule
  is not "handle rate limits", it is *a wait is not a verdict*.
- **Checking for pending arrivals across the whole pipeline, not per sheet, is deliberate.** A small
  sheet only gets the early-send shortcut when the pipeline is otherwise idle. Any other sheet still
  moving correctly suppresses it, because more jobs genuinely are coming.
- **Free workers were never the bottleneck.** Because workers refill the instant a job parks, 39
  rows were seen working across three different steps at once. The ceiling was scrape slots.
- **Duplicates are dropped, never substituted.** A 25-row sheet with 3 repeats produces 22 jobs, not
  25.

---

## 10. Bugs that live testing found

1. **No rule for when to send a tray.** The size limit was only a cap, so every tick sent whatever
   was waiting, producing trays of 1 or 2. Now it sends when the tray is full, when the oldest job
   has waited long enough, or when no more jobs can possibly arrive.
2. **Restarting a job silently dropped it off the economy lane**, so retries of rows that failed
   early were quietly re-billed at full price.
3. **Re-submitting a URL whose job had failed returned HTTP 500**, because the duplicate key was
   held forever. Now it returns a 409 naming the previous job.
4. **The front end fed jobs in 3 at a time** and waited for each trio to finish, a throttle written
   before the queue existed. It starved the workers and split sheets across small trays. Both modes
   now submit everything at once and let the workers be the limit.
5. **The scrape concurrency setting did nothing.** It was defined, set in `.env`, and read by
   nobody. The drip feeder hid this. It is now a real limit.
6. **Workers waited on each other.** Without `teamRefill`, one slow job held up the entire pool.
7. **A rate limit killed jobs outright.** Cost 15 jobs on 2026-08-23. See section 5.
8. **Waiting your turn counted as a strike.** Killed 9 rows of `batch_158` in about 25 seconds. See
   section 4.
9. **Restart recovery re-queued jobs that were waiting at the bus stop**, which the economy lane
   must never allow. It survived only because a guard in a different file caught it, and only
   because no jobs happened to be waiting during the one restart that would have hit it.
10. **GPU steps had no deadline at all.** If the container died, the job sat there forever with
    nobody looking at it.

Also fixed along the way: the poller used to log nothing during the wait, batch images were priced
at the full rate instead of half, images that came back without usage data were priced at $0, and
the status dialog folded economy rows into "still running" where they looked frozen instead of
showing "Queued at Google".

### How we look for this kind of bug

Every one of these was the same shape: **something waits, and nobody asked what happens if the other
side never answers.**

So every place the pipeline waits or hands off gets the same five questions:

1. What wakes it up?
2. What if that never happens?
3. How long can it sit there?
4. Who rescues it?
5. **Has that rescue path ever actually run?**

Question 5 is the one that finds things. Most of these paths were correct in the comments and had
never executed in reality.

The waiting points, for reference:

| Where a job waits | Woken by | Time limit | Rescued by |
|---|---|---|---|
| Submitted, waiting for a worker | the queue | 30 or 90 min | restart recovery |
| Running a step | the handler returning | step timeout | supervisor pass 1 |
| At a human gate | a person clicking Proceed | **none, by design** | a person |
| Economy bus stop | the collector | 10 min to send, 48h hard stop | poller |
| Tray at Google | the poller | 48h, enforced by us too | poller cleanup |
| Half-made tray | poller cleanup | 15 min | cleanup |
| GPU step | the GPU app responding | GPU timeout + grace | supervisor pass 2 |
| Scrape key paused | the pause expiring | the server's own retry delay | supervisor pass 4 |

`src/orchestration/drills.test.ts` turns these into 39 assertions across 10 drills, all pure, no
database and no network. Two of them were checked against the old broken code to confirm they
actually go red. A test that only agrees with the code it ships beside guards nothing.

---

## 11. Still open

- **Tray concurrency is measured but not explained.** We know three trays cost about an hour each.
  We do not know whether Google is queueing us against ourselves or whether it is ordinary variance.
  Bounded by the 6 hour stale warning and the 48 hour self-expiry, but not understood.
- **The already-ingested duplicate check has never run.** Jobs stop at the review queue under HITL,
  so nothing reaches `completed` and that branch is never reached. It needs a job pushed all the way
  through Go Live.
- **The 48 hour tray deadline and the GPU deadline sweep have never fired for real.**
- **Male avatar re-encode.** The file is 12.5 MB (JPEG bytes in a `.png`). It works, but we pay the
  upload cost every time the cache refreshes. Re-encoding to about 2 MB must **preserve the exact
  pixel dimensions**, because placement data is measured in pixels. Affects both lanes, so it needs
  a deliberate go-ahead.
- **Safety settings on the normal try-on lane.** The normal adapter sends none. The spike passed
  relaxed settings through batch with no issue. Changing either one changes live output.
- **Webhooks** would replace the polling cron entirely, once the service has a public address.
- **One drill gap.** Drill 1 checks the shared exclusion list, not that restart recovery actually
  uses it. If someone re-declares a local list in that file, the drill will not notice.

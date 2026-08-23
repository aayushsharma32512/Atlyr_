# Pipeline Wait & Handoff Audit

**Service:** `services/ingestion-automated`
**Date:** 2026-08-23
**Status:** F1–F5 closed. F6 dissolved by F2. F7 left as a tuning note.
**Method:** every point where the pipeline *waits* or *hands off* work, put through a fixed grid.

The rate-limit bug that cost 15 jobs on 2026-08-23 was found by talking, not by testing. That is
the problem this document exists to fix. It is one family of bug — **something waits, and nobody
asked what happens if the other side never answers** — and once you look for it deliberately, it
turns up in more than one place.

## The grid

Every boundary below was asked the same five questions:

1. **Who wakes it?** What event moves this job forward?
2. **What if that never happens?** Is there a second path?
3. **How long can it sit?** Is the wait bounded, and by what?
4. **Who rescues it?** Boot recovery, reaper, poller, a human?
5. **Has that rescue path ever actually run?** Or is it only asserted in a comment?

Question 5 is the one that matters. Most of these paths are correct in the comments and untested in
reality.

---

## Boundary inventory

| # | Boundary | Woken by | Bounded by | Rescued by |
|---|---|---|---|---|
| 1 | `POST /jobs` / `POST /batches` → queue | the route's `sendPipelineStep` | — | boot recovery |
| 2 | queue → worker → `dispatch()` | pg-boss fetch | `expireInSeconds` (1800 / 5400) | boot recovery |
| 3 | step → `advanceAndTrigger` → next step | the handler returning | — | reaper (boot only) |
| 4 | `awaiting_hitl_*` | a human, via `POST /jobs/:id/proceed` | **nothing** | a human |
| 5 | `vton_batch_queued` | the collector's claim | `MAX_WAIT` → flush; 48h → expire | poller |
| 6 | tray at Google | poller cron (`*/3`) | 48h deadline, self-enforced | poller janitor |
| 7 | tray `submitting`, no provider name | poller janitor | `SUBMIT_GRACE_SECONDS` (900) | janitor |
| 8 | `segmenting` / `placement` (Modal) | Modal's HTTP response | `MODAL_REQUEST_TIMEOUT_SECONDS` (900) | **nobody** |
| 9 | Firecrawl governor pause | pause expiry | `Retry-After` from the server | **nobody** |
| 10 | Gemini route breaker | half-open probe | breaker window | the router's sweep |

Rows 8 and 9 are where the findings cluster.

---

## Findings

### F1 — Boot recovery re-dispatches parked jobs · HIGH · **FIXED**

`reaper.ts` excludes parked states from its scan:

```ts
const EXTERNALLY_DRIVEN_STATES = ['segmenting', 'placement', ...PARKED_STATES];
```

`boot-recovery.ts` does not:

```ts
const EXTERNALLY_DRIVEN_STATES = ['segmenting', 'placement'];
```

A parked job **never has a queue row** — that is the whole design of `NO_ENQUEUE_STATES`. So every
parked job satisfies `findOrphanedJobs`' "nothing alive is backing it" clause, and boot recovery
treats each one as a corpse: cancels nothing, sends a fresh `vton_batch_queued` step, and logs
`resumed orphaned job`.

Today this is *survivable* only because `dispatch()` has a `PARKED_STATES` guard that returns
early. So the damage is a spurious queue row and a misleading log line per parked job per restart —
not lost work. But the correctness of a paid-for batch tray is resting entirely on a guard in a
different file. Remove that guard, or add a parked state without updating `dispatch()`, and a
restart destroys work that has already been billed.

It has not fired yet purely by luck: the 09:53 restart happened to land when zero jobs were parked.

**Fix:** `EXTERNALLY_DRIVEN_STATES` in `boot-recovery.ts` must include `...PARKED_STATES`, exactly
as the reaper's does. One line, and the asymmetry between the two files is itself the bug.

### F2 — A rate-limit failure is terminal · HIGH · **FIXED** (fired 2026-08-23, cost 15 jobs)

`dispatch()` treats every thrown error identically: `markJobFailed` (a terminal state), then
rethrow. `failed` is terminal, so nothing re-drives it — pg-boss's own retry returns immediately at
the terminal-state guard, which `send-step.ts` documents on purpose.

But a rate limit is not a failure, it is a **known-duration wait**. The governor read
`Retry-After: 57` and knows exactly how long to hold. Meanwhile `withRetry` burns its three
attempts in ~4 seconds — all three inside the paused window — and the job dies.

The information needed to tell these apart already exists and is already wired up:
`error-classify.ts` separates `rate_limited` / `transient` from `not_found` / `fatal_input` /
`refused`. `dispatch()` simply never asks.

**Fix:** classify before failing. On `rate_limited` (and arguably `transient`), leave
`current_state` alone and re-queue with pg-boss `startAfter` ≥ the governor's pause. `fatal_input`
keeps failing fast, which is correct. This also removes the need to hand-pace restarts.

### F3 — Modal states have no deadline at all · HIGH · **FIXED**

`segmenting` and `placement` are excluded from **both** the reaper and boot recovery, for a good
stated reason: Modal patches `current_state` out of band, so a row legitimately sits there with no
queue row for as long as the GPU takes.

The gap is what happens when the Modal side *also* dies. `modal.ts`'s timeout only fires inside a
live handler; if this process was killed, there is no handler, and if the container died there is
no patch coming either. The row sits in `segmenting` forever — reaper won't touch it, boot recovery
won't touch it, nothing else looks at it.

Compare the batch lane, which has exactly this shape and solved it: the poller **self-expires** a
tray past 48h *even when the provider is unreachable*, precisely so an unreadable tray cannot hold
its members forever. Modal states have no equivalent.

**Fix:** give the Modal states their own deadline sweep — a row idle in `segmenting`/`placement`
beyond `BOSS_MODAL_STEP_TIMEOUT_SECONDS` + grace, with no live queue row and no `segmentation_jobs`
progress, is dead and should be failed. Same argument, same shape, different subsystem.

### F4 — The reaper runs once at boot, and by default only logs · MEDIUM · **FIXED**

Two compounding facts:

- `reapStrandedJobs()` is called once from `index.ts`. There is no cron. A row stranded while the
  service runs continuously — e.g. the process survived but `advanceAndTrigger` threw between
  `updateState` and the send — is not looked at again until someone restarts the service.
- `REAPER_MODE` defaults to `'log'`, and is unset in `.env`. So even that one boot pass changes
  nothing; it prints candidates and moves on.

The default is defensible (the comment is explicit that a false positive fails live work), but the
combination means the rescue path for boundary #3 has, in practice, **never run**.

**Fix:** decide whether the reaper is real. If yes, run it periodically and flip to `fail` once the
logged candidates have proven genuinely stuck. If no, delete it rather than leaving a rescue path
everything else assumes exists.

### F5 — The collector cannot see whether more rows are coming · MEDIUM · **FIXED** (~11 min per small sheet)

`shouldFlushTray` is fill-or-age: ship at `MIN_FILL` (20), or when the oldest parked job passes
`MAX_WAIT` (600s). `MIN_FILL` is a **guess** at the real question, which is "are more rows still on
their way?"

For a 15-row sheet the guess is always wrong:

| t | |
|---|---|
| ~0–120s | rows clear scrape → identify → summary and park |
| ~120s | tray is complete — 15/15 parked, nothing more can arrive |
| ~640s | oldest job finally crosses `MAX_WAIT` |
| ~640–900s | next flush tick actually ships it |

Roughly **11 minutes of dead time on a tray that was ready at two minutes**, and it repeats for
every sheet smaller than `MIN_FILL`.

Since #78 the real answer is available: batches have identity (`ingestion_batches`, `jobs.batch_id`).
A batch with zero jobs left in a pre-park, non-terminal state cannot produce another parked row.

**Fix:** flush when no more arrivals are possible —

```sql
SELECT count(*) FROM ingestion_pipeline_jobs
 WHERE batch_id = $1
   AND current_state IN ('pending','scraping','identifying','generating_garment_summary')
```

zero ⇒ ship now, whatever the count. Keep `MIN_FILL` as the fallback for parked jobs with no batch
(manual submissions) or batches still filling. Watch the edge case: jobs that failed upstream, or
are pinned to a non-Gemini VTON model, never park — counting them as "still coming" makes the tray
wait forever.

### F6 — `tryAcquire` never waits, so overflow dies instead of queueing · MEDIUM · **DISSOLVED BY F2**

`governor.tryAcquire` is deliberately non-blocking, and for the Gemini router that is right: there
are many pools, so skipping to the next one is strictly better than queueing behind a busy one.

Firecrawl inherited the same primitive with two pools. When both are busy there is nowhere to skip
to, and the call reports `All Firecrawl keys are rate limited or out of credits` — a job that
should have waited three seconds is instead killed. With `FIRECRAWL_MAX_CONCURRENCY=3` and two
keys there are 6 slots against 12 workers, so under any real sheet **half the jobs hit this path**.

This is why re-driving the 15 failed jobs had to be hand-paced in groups of 4.

**Fix:** F2 largely subsumes this — if a rate-limited job re-queues instead of dying, overflow
becomes a delay rather than a failure. Raising `FIRECRAWL_MAX_CONCURRENCY` to ~6 helps throughput
but is a tuning knob, not a fix.

### F7 — Scrape is the front bottleneck while workers idle · LOW · tuning

`BOSS_TEAM_SIZE=12`, but scraping is gated at `FIRECRAWL_MAX_CONCURRENCY` per key. During the
scrape phase of a sheet, most of the team has nothing to do. This is the real answer to "what
should free workers do" — the waste is at the **front** of the pipeline, not during the batch wait.
Parked jobs hold no worker slot at all, so the batch wait costs nothing in capacity.

Worth noting rather than fixing blind: raising the gate trades against the plan's per-minute limit,
which the governor discovers rather than configures.

---

## Resolution

| Finding | Fixed by |
|---|---|
| **F1** parked jobs treated as corpses | `recovery-scope.ts` — one shared exclusion list, so the two rescue passes cannot drift again |
| **F2** rate limit terminal | `step-retry.ts` + `dispatch()` classify before failing; retryable errors re-queue with `startAfter` instead of dying |
| **F3** Modal had no deadline | `custodian.ts` fails Modal rows idle past `BOSS_MODAL_STEP_TIMEOUT_SECONDS` + grace with nothing backing them |
| **F4** reaper boot-only and log-only | folded into the custodian's 5-minute tick; `REAPER_MODE` default → `fail` |
| **F5** blind `MIN_FILL` | `hasPendingArrivals()` + a `'complete'` flush trigger — ship when nothing more can arrive |
| **F6** overflow dies instead of waiting | dissolved: "all keys busy" is now a deferral, and `UpstreamBusyError` carries the governor's real remaining pause |
| **F7** scrape gate vs idle workers | left open — a tuning trade-off against the plan's per-minute limit, not a correctness bug |

F1, F2 and F3 were the same mistake in three places: **a wait with no bound and no owner.** Each now
has both. F5 was its mirror image — a bound measured against the wrong thing — and now measures the
real question.

## What the drills cover

`src/orchestration/drills.test.ts` encodes these as assertions rather than prose: 39 tests across 10
drills, all pure (no config, no DB, no network).

Two of them were proven to have teeth by replaying the invariant against the pre-fix code and
confirming it goes red — drill 1 against boot recovery's old list, drill 8 against the old
fill-or-age rule. A test that only agrees with the code it ships alongside guards nothing.

Still open as a known limitation: drill 1 asserts `recovery-scope.ts`, not `boot-recovery.ts`'s use
of it. If someone re-declares a local list in that file the drill will not notice. Catching that
needs a source-level check, which is brittle enough that it was left out deliberately.

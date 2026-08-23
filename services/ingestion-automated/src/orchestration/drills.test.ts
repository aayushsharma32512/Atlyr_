/**
 * Failure drills — the audit in docs/pipeline-wait-audit.md, expressed as assertions.
 *
 * Every drill encodes one invariant about a place where the pipeline WAITS or HANDS OFF work.
 * They exist because the bug that cost 15 jobs on 2026-08-23 was found by talking rather than by
 * testing: each of these invariants was true in a comment and unchecked in reality.
 *
 * Deliberately pure — no config import, no DB, no network — so this file can run without the
 * env-validating config killing the test process (see CLAUDE.md). That constraint is also what
 * forced `recovery-scope.ts` to exist, and extracting it is what surfaced drill 1's bug.
 */
import { describe, expect, test } from 'bun:test';
import {
  HITL_STATES,
  NO_ENQUEUE_STATES,
  PARKED_STATES,
  TERMINAL_STATES,
  hasTransition,
} from './state-machine';
import {
  EXTERNALLY_DRIVEN_STATES,
  MODAL_DRIVEN_STATES,
  RESCUE_EXCLUDED_STATES,
} from './recovery-scope';
import { classifyError, extractRetryDelayMs } from '../utils/error-classify';
import { decideStepFailure } from './step-retry';
import { ModalTimeoutError, shouldRetryModalCall } from '../adapters/modal.protocol';
import {
  CORRELATION_KEY,
  isPastDeadline,
  isSpendCapError,
  isTerminalStatus,
  readBatchItem,
  shouldFlushTray,
} from '../adapters/gemini-batch.protocol';

// ─── Drill 1 · a rescue pass must never mistake a parked job for a corpse ────
//
// F1. A parked job never has a queue row — NO_ENQUEUE_STATES guarantees it. So "no queue row
// backing this job" is worthless as evidence of death for these states, and any pass that treats
// it as evidence will re-dispatch a tray that has already been paid for.
//
// This drill is the finding: the two passes each kept their own copy of this list and the copies
// drifted. It passes only because both now read the same one.
describe('drill 1 — parked jobs are not corpses', () => {
  test('every parked state is externally driven', () => {
    for (const state of PARKED_STATES) {
      expect(EXTERNALLY_DRIVEN_STATES).toContain(state);
    }
  });

  test('every Modal-driven state is externally driven', () => {
    for (const state of MODAL_DRIVEN_STATES) {
      expect(EXTERNALLY_DRIVEN_STATES).toContain(state);
    }
  });

  test('no rescue pass may touch a terminal, HITL, or externally driven row', () => {
    for (const state of [...TERMINAL_STATES, ...HITL_STATES, ...EXTERNALLY_DRIVEN_STATES]) {
      expect(RESCUE_EXCLUDED_STATES).toContain(state);
    }
  });

  // The property that actually matters, stated directly: if a state is entered without enqueueing
  // anything, then nothing may later read "no queue row" as proof that it died.
  test('anything entered without a queue row is excluded from rescue', () => {
    for (const state of NO_ENQUEUE_STATES) {
      expect(RESCUE_EXCLUDED_STATES).toContain(state);
    }
  });
});

// ─── Drill 2 · a parked state has no transition of its own ───────────────────
//
// The poller resumes a parked job by replaying the generating_vton edge, so there must be no
// second path into segmenting to keep in sync. If someone adds one, the two paths drift.
describe('drill 2 — parked states are resumed by replay, not by their own edge', () => {
  test('no parked state has a TRANSITIONS entry', () => {
    for (const state of PARKED_STATES) {
      expect(hasTransition(state)).toBe(false);
    }
  });

  test('a parked state is neither terminal nor HITL', () => {
    for (const state of PARKED_STATES) {
      expect(TERMINAL_STATES).not.toContain(state);
      expect(HITL_STATES).not.toContain(state);
    }
  });
});

// ─── Drill 3 · a rate limit is a wait, not a failure ─────────────────────────
//
// F2. This is the classification the dispatcher needs and currently never asks for. The drill
// pins that the information EXISTS and is unambiguous; the dispatcher acting on it is the fix.
describe('drill 3 — a rate limit is distinguishable from a real failure', () => {
  test('429 classifies as rate_limited, not as fatal input', () => {
    const err = Object.assign(new Error('Firecrawl error 429: rate limit exceeded'), { status: 429 });
    expect(classifyError(err)).toBe('rate_limited');
    expect(classifyError(err)).not.toBe('fatal_input');
  });

  test('a 4xx that is not a rate limit is fatal and must fail fast', () => {
    const err = Object.assign(new Error('Firecrawl error 400: bad url'), { status: 400 });
    expect(classifyError(err)).toBe('fatal_input');
  });

  test('a 404 is not retryable as a rate limit', () => {
    const err = Object.assign(new Error('model not found'), { status: 404 });
    expect(classifyError(err)).toBe('not_found');
  });

  // The governor pauses for exactly as long as the server asked. That number is what a re-queue
  // delay should be derived from, instead of the ~1s backoff that burned all three retries inside
  // a 57-second window on 2026-08-23.
  test("the server's own retry window is recoverable from the error", () => {
    const err = new Error('Rate limit exceeded. please retry after 57s');
    const delay = extractRetryDelayMs(err);
    expect(delay).toBeGreaterThanOrEqual(57_000);
  });

  // The part that actually killed the jobs: knowing it is a rate limit is useless unless the
  // failure path acts on it. These assert the policy dispatch() now runs, not just the label.
  const decide = (err: unknown, errorCount = 0) =>
    decideStepFailure({ err, errorCount, maxAttempts: 5, fallbackDelayMs: 60_000 });

  test('a rate limit defers the step instead of failing the job', () => {
    const err = Object.assign(new Error('429 rate limited'), { status: 429 });
    const d = decide(err);
    expect(d.action).toBe('retry');
  });

  test('a transient upstream also defers — a 503 storm is the same shape as a 429 storm', () => {
    const err = Object.assign(new Error('503 upstream unavailable'), { status: 503 });
    expect(decide(err).action).toBe('retry');
  });

  test('a bad request still fails fast — no amount of waiting fixes it', () => {
    const err = Object.assign(new Error('400 bad url'), { status: 400 });
    const d = decide(err);
    expect(d.action).toBe('fail');
    if (d.action === 'fail') expect(d.reason).toBe('not-retryable');
  });

  test('the deferral waits as long as the server asked, not a guess', () => {
    const d = decide(new Error('Rate limit exceeded. please retry after 57s'));
    expect(d.action).toBe('retry');
    if (d.action === 'retry') expect(d.delayMs).toBeGreaterThanOrEqual(57_000);
  });

  // The exact error that killed the 15 jobs: a bare Error with no HTTP status. It now carries the
  // governor's real remaining pause, so the deferral is accurate instead of a fallback guess.
  test('an "all keys busy" error carries its own wait', () => {
    const err = Object.assign(new Error('All Firecrawl keys are rate limited or out of credits'), {
      retryAfterMs: 57_000,
    });
    const d = decide(err);
    expect(d.action).toBe('retry');
    if (d.action === 'retry') expect(d.delayMs).toBe(57_000);
  });

  test('with no stated delay it falls back rather than retrying immediately', () => {
    const d = decide(Object.assign(new Error('429 slow down'), { status: 429 }));
    expect(d.action).toBe('retry');
    if (d.action === 'retry') expect(d.delayMs).toBe(60_000);
  });
});

// ─── Drill 4 · a Modal timeout must never be retried ─────────────────────────
//
// A Modal request is not a pure read: the Python writes ingestion_pipeline_jobs and
// segmentation_jobs itself, keyed by the ids in the query string. On timeout the container is
// very likely still working, so a retry runs the same job on a second GPU, doubles the bill, and
// leaves two containers writing the same rows.
describe('drill 4 — a Modal timeout is not retried', () => {
  test('timeout is never retried', () => {
    expect(shouldRetryModalCall(new ModalTimeoutError('https://modal/segment', 900_000))).toBe(false);
  });

  test('a connection-level failure is retried — nothing ran, nothing was billed', () => {
    const err = Object.assign(new Error('fetch failed'), { code: 'ECONNREFUSED' });
    expect(shouldRetryModalCall(err)).toBe(true);
  });

  test('an HTTP response is never retried — the function ran and may have written rows', () => {
    expect(shouldRetryModalCall(Object.assign(new Error('modal 500'), { status: 500 }))).toBe(false);
    expect(shouldRetryModalCall(Object.assign(new Error('modal 400'), { status: 400 }))).toBe(false);
  });
});

// ─── Drill 5 · a spend cap must not be mistaken for a rate limit ─────────────
//
// Both return 429, and they want opposite reactions: back off and retry, versus stop submitting
// entirely and shout. Only the message separates them. This ambiguity silently disabled the
// interactive AI Studio route for a full day.
describe('drill 5 — spend cap is not a rate limit', () => {
  test('a spend cap message is recognised', () => {
    expect(isSpendCapError(new Error('429 monthly budget exceeded for this project'))).toBe(true);
    expect(isSpendCapError(new Error('Spending limit reached'))).toBe(true);
  });

  test('an ordinary 429 is not treated as a spend cap', () => {
    expect(isSpendCapError(new Error('429 Too Many Requests: rate limit exceeded'))).toBe(false);
  });
});

// ─── Drill 6 · nothing may wait on a tray forever ────────────────────────────
//
// A tray Google never answers about must still release its members. The poller self-expires on
// the 48h deadline even when the provider is unreachable — that is what stops an unreadable tray
// holding paid-for jobs indefinitely.
//
// F3 notes that segmenting/placement have NO equivalent bound. There is nothing to assert here
// yet; that drill lands with the fix.
describe('drill 6 — a tray is bounded even when the provider goes silent', () => {
  const now = Date.parse('2026-08-23T12:00:00Z');

  test('a tray past 48h is expired regardless of reported status', () => {
    expect(isPastDeadline('2026-08-21T11:00:00Z', now)).toBe(true);
  });

  test('a young tray is not expired', () => {
    expect(isPastDeadline('2026-08-23T09:00:00Z', now)).toBe(false);
  });

  test('succeeded, failed and expired are all terminal — each must sweep its members', () => {
    expect(isTerminalStatus('succeeded')).toBe(true);
    expect(isTerminalStatus('failed')).toBe(true);
    expect(isTerminalStatus('expired')).toBe(true);
    expect(isTerminalStatus('pending')).toBe(false);
    expect(isTerminalStatus('running')).toBe(false);
    expect(isTerminalStatus('submitting')).toBe(false);
  });
});

// ─── Drill 7 · results are matched by job id, never by position ──────────────
//
// A batch response is not guaranteed to preserve request order. Matching by index would attach one
// garment's image to another product — a silent, catalogue-visible corruption.
describe('drill 7 — batch results correlate by id', () => {
  test('a result carries its job id and is read from there', () => {
    const item = {
      metadata: { [CORRELATION_KEY]: 'job-abc' },
      response: {
        candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'AAAA' } }] } }],
      },
    };
    const result = readBatchItem(item as never);
    expect(result.outcome).toBe('image');
    if (result.outcome === 'image') expect(result.jobId).toBe('job-abc');
  });

  test('a result with no job id is discarded rather than guessed at', () => {
    const item = {
      response: {
        candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'AAAA' } }] } }],
      },
    };
    expect(readBatchItem(item as never).outcome).toBe('uncorrelated');
  });
});

// ─── Drill 8 · the flush rule ────────────────────────────────────────────────
//
// F5. This pins the rule as it stands today, so the intended change is visible as a diff rather
// than as a silent behaviour shift. The gap it documents: `waiting` is the only signal, and it
// cannot express "this batch is complete, nothing more is coming" — which is why a 15-row sheet
// sits for ~11 minutes under MIN_FILL=20 before the age trigger releases it.
describe('drill 8 — fill-or-age, and what it cannot see', () => {
  const rule = (waiting: number, oldestAgeSeconds: number) =>
    shouldFlushTray({ waiting, oldestAgeSeconds, minFill: 20, maxWaitSeconds: 600 });

  test('a full tray ships immediately', () => {
    expect(rule(20, 0).flush).toBe(true);
    expect(rule(20, 0).trigger).toBe('full');
  });

  test('an aged trickle ships rather than being stranded', () => {
    expect(rule(3, 600).flush).toBe(true);
    expect(rule(3, 600).trigger).toBe('max-wait');
  });

  test('an empty pool never ships', () => {
    expect(rule(0, 99_999).flush).toBe(false);
  });

  // F5, fixed. A complete 15-row sheet used to be indistinguishable from a still-filling one and
  // waited out the full MAX_WAIT for nothing. It now ships as soon as nothing more can arrive.
  test('a complete-but-small tray ships immediately', () => {
    const d = shouldFlushTray({
      waiting: 15, oldestAgeSeconds: 120, minFill: 20, maxWaitSeconds: 600, noMoreArrivals: true,
    });
    expect(d.flush).toBe(true);
    expect(d.trigger).toBe('complete');
  });

  test('a still-filling tray under the fill line is still held', () => {
    const d = shouldFlushTray({
      waiting: 15, oldestAgeSeconds: 120, minFill: 20, maxWaitSeconds: 600, noMoreArrivals: false,
    });
    expect(d.flush).toBe(false);
  });

  // "Nothing more is coming" must never manufacture a tray out of nothing.
  test('completeness does not ship an empty tray', () => {
    const d = shouldFlushTray({
      waiting: 0, oldestAgeSeconds: 0, minFill: 20, maxWaitSeconds: 600, noMoreArrivals: true,
    });
    expect(d.flush).toBe(false);
  });

  // Absent the signal the rule must behave exactly as before, so nothing changes for callers that
  // cannot answer the question.
  test('without the signal the old fill-or-age rule is unchanged', () => {
    expect(rule(15, 120).flush).toBe(false);
    expect(rule(20, 0).trigger).toBe('full');
    expect(rule(3, 600).trigger).toBe('max-wait');
  });
});

// ─── Drill 9 · exactly one pass may claim a stuck row ────────────────────────
//
// F3/F4. The custodian resumes orphans AND fails timed-out Modal rows in the same tick. If a state
// were eligible for both, the two passes would fight: one re-dispatches while the other fails.
// The Modal states are excluded from the orphan scan for exactly this reason.
describe('drill 9 — the custodian passes do not overlap', () => {
  test('a Modal state is never resumed by the orphan pass', () => {
    for (const state of MODAL_DRIVEN_STATES) {
      expect(RESCUE_EXCLUDED_STATES).toContain(state);
    }
  });

  test('a parked state is claimed by neither pass — the poller owns it', () => {
    for (const state of PARKED_STATES) {
      expect(RESCUE_EXCLUDED_STATES).toContain(state);
      expect(MODAL_DRIVEN_STATES).not.toContain(state);
    }
  });
});

// ─── Drill 10 · deferring must not become an infinite loop ───────────────────
//
// The one thing a defer-instead-of-fail policy can get badly wrong: a permanently broken upstream —
// a revoked key, a dead endpoint — cycling jobs forever with no failure ever surfacing in the UI.
describe('drill 10 — the attempt cap is honoured', () => {
  const rateLimited = () => Object.assign(new Error('429 rate limited'), { status: 429 });
  const decide = (errorCount: number) =>
    decideStepFailure({ err: rateLimited(), errorCount, maxAttempts: 5, fallbackDelayMs: 60_000 });

  test('early attempts defer', () => {
    expect(decide(0).action).toBe('retry');
    expect(decide(3).action).toBe('retry');
  });

  test('at the cap it fails rather than deferring again', () => {
    const d = decide(4);
    expect(d.action).toBe('fail');
    if (d.action === 'fail') expect(d.reason).toBe('attempts-exhausted');
  });

  test('past the cap it stays failed — no way back into the loop', () => {
    expect(decide(9).action).toBe('fail');
  });

  // Regression: backpressure is NOT an error. Every upstream slot being busy means this job never
  // ran, so charging it against the cap kills jobs for queue position. 24 jobs against 6 slots
  // failed 9 of them in ~25 seconds that way on 2026-08-23.
  test('backpressure never charges an attempt, however long the queue', () => {
    const busy = Object.assign(new Error('All Firecrawl keys are rate limited or out of credits'), {
      retryAfterMs: 5_000,
      backpressure: true,
    });
    for (const errorCount of [0, 4, 9, 50]) {
      const d = decideStepFailure({ err: busy, errorCount, maxAttempts: 5, fallbackDelayMs: 60_000 });
      expect(d.action).toBe('retry');
      if (d.action === 'retry') expect(d.countsAgainstCap).toBe(false);
    }
  });

  // The distinction that matters: a PAUSED upstream (it told us to stop) is still capped.
  test('a real rate limit is still capped', () => {
    const paused = Object.assign(new Error('all keys paused'), {
      retryAfterMs: 57_000,
      backpressure: false,
      status: 429,
    });
    const d = decideStepFailure({ err: paused, errorCount: 4, maxAttempts: 5, fallbackDelayMs: 60_000 });
    expect(d.action).toBe('fail');
  });

  test('the attempt number counts the failure being handled', () => {
    const d = decide(2);
    expect(d.action).toBe('retry');
    if (d.action === 'retry') expect(d.attempt).toBe(3);
  });
});

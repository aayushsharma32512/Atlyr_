/**
 * Why did every key decline, and does this job deserve to lose a life for it?
 *
 * The adapter walks its keys and, when none serves the request, has to answer one question: was
 * this the JOB's failure, or the POOL's? The codebase already got this right once — a saturated
 * pool (every slot busy) is backpressure, and charging it against the retry cap "kills jobs for
 * waiting their turn". But the parked case was lumped into a single 'paused' verdict that always
 * charged, and parking happens for two very different reasons:
 *
 *   429 rate limited  — transient. Heals in seconds. The job never ran.
 *   402 out of credits — needs a human with a credit card. Hours or days.
 *
 * Collapsing them cost the whole backlog on 2026-09-13: the custodian restarted 50 jobs at once,
 * the burst tripped the per-minute rate limit, all keys parked on 429, and 44 jobs were each
 * charged an attempt within 20 seconds for a scrape that never happened. Three ticks of that and
 * every job hits the cap and dies permanently — a retry storm eating its own backlog.
 *
 * Pure — no config, no network — so the drills can exercise it (see CLAUDE.md).
 */
export type ParkReason = 'credits' | 'rate_limit';

export interface PoolSnapshot {
  /** 0 when the pool is not parked (it may still be merely out of slots). */
  pauseRemainingMs: number;
  /** Why it was parked. Undefined when it is not parked. */
  parkReason?: ParkReason;
}

export type ExhaustionReason = 'saturated' | 'rate_limited' | 'credits_exhausted';

export interface Exhaustion {
  reason: ExhaustionReason;
  /** True when the job never ran for a reason that will clear on its own — do NOT charge it. */
  backpressure: boolean;
  retryAfterMs: number;
}

/** A saturated pool frees as in-flight calls finish — seconds, not a rate-limit window. */
export const SATURATED_RETRY_MS = 5_000;

/**
 * Longest a job may be re-queued for on a TRANSIENT exhaustion (saturated or rate limited).
 *
 * The upstream's own retry-after is honoured up to this, never beyond it. Firecrawl was observed
 * (2026-09-13) answering a 429 with a retry-after counting down to a fixed window reset ~77
 * minutes out; honoured verbatim, every job that found both keys parked went to sleep until
 * 14:40 — twice, across two process restarts — and the pipeline looked dead for over an hour.
 *
 * Capping is free here: a transient deferral is backpressure, so the job is not charged for the
 * extra re-check, and the governor still refuses a slot on a parked key, so an earlier re-check
 * cannot hammer the upstream. It just asks "any capacity yet?" every few minutes instead of once
 * an hour. `credits_exhausted` is deliberately NOT capped: that path is charged, needs a human,
 * and re-asking a key with no money every ten minutes would only burn the retry budget.
 */
export const MAX_TRANSIENT_RETRY_MS = 10 * 60 * 1000;

export function classifyPoolExhaustion(
  pools: readonly PoolSnapshot[],
  saturatedRetryMs: number = SATURATED_RETRY_MS,
): Exhaustion {
  if (pools.length === 0) {
    return { reason: 'saturated', backpressure: true, retryAfterMs: saturatedRetryMs };
  }

  const retryAfterMs = Math.min(
    ...pools.map((p) => (p.pauseRemainingMs > 0 ? p.pauseRemainingMs : saturatedRetryMs)),
  );

  const transientRetryMs = Math.min(retryAfterMs, MAX_TRANSIENT_RETRY_MS);

  // Any key still unparked means there is real capacity behind this — it was simply busy.
  if (pools.some((p) => p.pauseRemainingMs <= 0)) {
    return { reason: 'saturated', backpressure: true, retryAfterMs: transientRetryMs };
  }

  // Everything is parked. Charging is reserved for the one case that provably needs a human:
  // EVERY pool explicitly reported 402. Anything else — a rate limit, or a park whose reason was
  // never recorded — clears on its own and the job never ran. The reason map is best-effort
  // bookkeeping beside the governor's pause state and the two can disagree; resolving the gap to
  // "out of credits" made every bookkeeping miss cost a job an attempt and a six-hour sleep.
  if (!pools.every((p) => p.parkReason === 'credits')) {
    return { reason: 'rate_limited', backpressure: true, retryAfterMs: transientRetryMs };
  }

  // Every key is out of credits. Only a human fixes this, so it IS the job's verdict: charge it,
  // let it fail, and let the custodian re-try it later on the slow clock.
  return { reason: 'credits_exhausted', backpressure: false, retryAfterMs };
}

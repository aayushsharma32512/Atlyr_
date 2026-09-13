import { describe, expect, test } from 'bun:test';
import { classifyPoolExhaustion, MAX_TRANSIENT_RETRY_MS, SATURATED_RETRY_MS } from './key-pool-state';

const unparked = { pauseRemainingMs: 0 };
const rateLimited = (ms = 57_000) => ({ pauseRemainingMs: ms, parkReason: 'rate_limit' as const });
const outOfCredits = (ms = 6 * 60 * 60 * 1000) => ({ pauseRemainingMs: ms, parkReason: 'credits' as const });

describe('pool exhaustion — who pays for the failure', () => {
  test('some capacity left, just busy → backpressure, never charged', () => {
    const e = classifyPoolExhaustion([unparked, outOfCredits()]);
    expect(e.reason).toBe('saturated');
    expect(e.backpressure).toBe(true);
  });

  // The 2026-09-13 regression: a retry burst tripped the rate limit and 44 jobs were each charged
  // an attempt for a scrape that never happened.
  test('all keys parked but one is only rate limited → backpressure, NOT charged', () => {
    const e = classifyPoolExhaustion([rateLimited(), outOfCredits()]);
    expect(e.reason).toBe('rate_limited');
    expect(e.backpressure).toBe(true);
  });

  test('every key genuinely out of credits → charged, so a human sees a dead key', () => {
    const e = classifyPoolExhaustion([outOfCredits(), outOfCredits()]);
    expect(e.reason).toBe('credits_exhausted');
    expect(e.backpressure).toBe(false);
  });

  test('a rate limit anywhere outranks credits — it heals without anyone', () => {
    expect(classifyPoolExhaustion([outOfCredits(), outOfCredits(), rateLimited()]).backpressure).toBe(true);
  });

  test('retryAfter is the soonest any pool could serve', () => {
    expect(classifyPoolExhaustion([rateLimited(57_000), outOfCredits(21_600_000)]).retryAfterMs).toBe(57_000);
  });

  test('an unparked pool retries soon, not after the parked one', () => {
    expect(classifyPoolExhaustion([unparked, outOfCredits()], 5_000).retryAfterMs).toBe(5_000);
  });

  test('no keys configured is treated as capacity, not a verdict', () => {
    expect(classifyPoolExhaustion([]).backpressure).toBe(true);
  });
});

// ─── A transient park must not sleep a job for hours ─────────────────────────
//
// Observed 2026-09-13: Firecrawl answered a 429 with a retry-after counting down to a fixed
// window reset (~77 min away). The adapter honoured it verbatim, so every job that found both
// keys parked was re-queued for 14:40 — twice, across two separate process restarts. The
// pipeline looked dead for over an hour on a condition that a 10-minute re-check would have
// survived. Backpressure is not charged, so re-checking sooner costs nothing; the governor still
// refuses a slot on a parked key, so it cannot hammer the upstream either.
describe('pool exhaustion — transient deferrals are capped', () => {
  const SEVENTY_SEVEN_MIN = 77 * 60 * 1000;

  test('a rate-limit park longer than the ceiling is clamped to the ceiling', () => {
    const e = classifyPoolExhaustion([rateLimited(SEVENTY_SEVEN_MIN), rateLimited(SEVENTY_SEVEN_MIN)]);
    expect(e.reason).toBe('rate_limited');
    expect(e.backpressure).toBe(true);
    expect(e.retryAfterMs).toBe(MAX_TRANSIENT_RETRY_MS);
  });

  test('a short rate-limit park is honoured as-is', () => {
    expect(classifyPoolExhaustion([rateLimited(57_000), rateLimited(57_000)]).retryAfterMs).toBe(57_000);
  });

  test('saturated retry is unaffected — already far below the ceiling', () => {
    expect(classifyPoolExhaustion([unparked, outOfCredits()]).retryAfterMs).toBe(SATURATED_RETRY_MS);
  });

  // Credits genuinely need a human, and this path IS charged — the long clock is the point.
  test('credits exhausted keeps the full pause — that one is a verdict, not a wait', () => {
    const e = classifyPoolExhaustion([outOfCredits(6 * 60 * 60 * 1000), outOfCredits(6 * 60 * 60 * 1000)]);
    expect(e.reason).toBe('credits_exhausted');
    expect(e.retryAfterMs).toBe(6 * 60 * 60 * 1000);
  });

  test('the ceiling is minutes, not hours', () => {
    expect(MAX_TRANSIENT_RETRY_MS).toBeLessThanOrEqual(10 * 60 * 1000);
    expect(MAX_TRANSIENT_RETRY_MS).toBeGreaterThanOrEqual(60 * 1000);
  });
});

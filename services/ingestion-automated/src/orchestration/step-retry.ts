/**
 * What to do when a step throws.
 *
 * `dispatch()` used to treat every error the same way: mark the job `failed` and rethrow. That is
 * right for a bad URL and wrong for a rate limit, which is not a verdict but a **wait with a known
 * duration** — the server said "retry after 57s" and the governor paused the pool for exactly that
 * long. Failing there killed 15 jobs on 2026-08-23, and the three pg-boss retries that followed
 * were no-ops by construction: `failed` is terminal, so every retry returned at dispatch's
 * terminal-state guard.
 *
 * The information needed to tell these apart already existed (`classifyError`,
 * `extractRetryDelayMs`); nothing consumed it. This module is that consumer, kept pure — no config,
 * no DB, no queue — so the drills can exercise the policy rather than a log line.
 */
import { classifyError, extractRetryDelayMs, type ErrorKind } from '../utils/error-classify';

/** Kinds that mean "not now" rather than "not ever". */
const RETRYABLE: readonly ErrorKind[] = ['rate_limited', 'transient'];

export type StepFailureDecision =
  | { action: 'retry'; delayMs: number; kind: ErrorKind; attempt: number }
  | { action: 'fail'; kind: ErrorKind; reason: 'not-retryable' | 'attempts-exhausted' };

export interface StepFailureInput {
  err: unknown;
  /** `error_count` from the job row BEFORE this failure is recorded. */
  errorCount: number;
  /** Total attempts allowed before the job is failed for good. */
  maxAttempts: number;
  /** Used when the upstream named no delay of its own. */
  fallbackDelayMs: number;
}

export function decideStepFailure(input: StepFailureInput): StepFailureDecision {
  const kind = classifyError(input.err);

  // `not_found` and `fatal_input` never heal: no amount of waiting fixes a retired model id or a
  // malformed request, and re-queueing them would burn scrape credits and Gemini calls on work
  // that cannot succeed. Fail fast, exactly as before.
  if (!RETRYABLE.includes(kind)) return { action: 'fail', kind, reason: 'not-retryable' };

  // The cap is what stops a permanently broken upstream — a revoked key, a dead endpoint — from
  // cycling jobs forever with no failure ever surfacing in the UI.
  const attempt = input.errorCount + 1;
  if (attempt >= input.maxAttempts) return { action: 'fail', kind, reason: 'attempts-exhausted' };

  return {
    action: 'retry',
    kind,
    attempt,
    delayMs: extractRetryDelayMs(input.err) ?? input.fallbackDelayMs,
  };
}

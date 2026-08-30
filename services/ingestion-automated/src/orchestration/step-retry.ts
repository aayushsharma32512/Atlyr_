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
import { classifyError, errorHttpStatus, extractRetryDelayMs, type ErrorKind } from '../utils/error-classify';

/** Kinds that mean "not now" rather than "not ever". */
const RETRYABLE: readonly ErrorKind[] = ['rate_limited', 'transient'];

export type StepFailureDecision =
  | {
      action: 'retry';
      delayMs: number;
      kind: ErrorKind;
      attempt: number;
      /**
       * False when the deferral is pure backpressure — every upstream slot was busy, so this job
       * never even got to try. Waiting your turn is not an error, and counting it burns the retry
       * budget on queue position: 24 jobs against 6 slots killed 9 of them in ~25s that way.
       */
      countsAgainstCap: boolean;
    }
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

/**
 * Pure backpressure: every upstream slot was in use, so the request was never attempted. Duck-typed
 * so this module keeps its zero dependencies — adapters set it when they can tell the difference
 * between "the upstream told us to stop" and "our own capacity is busy".
 */
function isBackpressure(err: unknown): boolean {
  return (err as { backpressure?: unknown })?.backpressure === true;
}

export function decideStepFailure(input: StepFailureInput): StepFailureDecision {
  const kind = classifyError(input.err);

  // `not_found` and `fatal_input` never heal: no amount of waiting fixes a retired model id or a
  // malformed request, and re-queueing them would burn scrape credits and Gemini calls on work
  // that cannot succeed. Fail fast, exactly as before.
  if (!RETRYABLE.includes(kind)) return { action: 'fail', kind, reason: 'not-retryable' };

  const delayMs = extractRetryDelayMs(input.err) ?? input.fallbackDelayMs;

  // Backpressure is exempt from the cap. The job did not fail — it did not run. The bound here is
  // the pipeline's own throughput: slots free as the jobs holding them finish, so this resolves on
  // its own. A genuinely dead upstream reports `paused`, not `saturated`, and is capped below.
  if (isBackpressure(input.err)) {
    return { action: 'retry', kind, attempt: input.errorCount, delayMs, countsAgainstCap: false };
  }

  // The cap is what stops a permanently broken upstream — a revoked key, a dead endpoint — from
  // cycling jobs forever with no failure ever surfacing in the UI.
  const attempt = input.errorCount + 1;
  if (attempt >= input.maxAttempts) return { action: 'fail', kind, reason: 'attempts-exhausted' };

  return { action: 'retry', kind, attempt, delayMs, countsAgainstCap: true };
}

/**
 * HTTP statuses that mean "this could not run right now" rather than "this request is wrong".
 *
 * 402 is the one worth spelling out. `classifyError` reads it as `fatal_input` because it is a 4xx,
 * but "insufficient credits" says nothing about the request — the URL, the garment and the prompt
 * were all fine; the key ran out of money. The Firecrawl adapter already knows this and parks the
 * key for six hours on 402, exactly as it does for a rate limit. It only becomes fatal when EVERY
 * key is dead, and even then it heals the moment someone tops up or the billing period rolls over.
 *
 * It is deliberately not folded into `classifyError` as `rate_limited`: that would make the
 * dispatcher defer it every 60s and burn the whole attempt cap inside five minutes, on something
 * that needs hours. Failing fast is right — the operator SHOULD see a dead key — and the custodian
 * retries it later on a much slower clock.
 */
const CAPACITY_STATUSES: readonly number[] = [402];

/**
 * Should a job that has already been marked `failed` be retried automatically, later?
 *
 * A broader question than `decideStepFailure`'s: that one asks "defer this right now", this one
 * asks "is this worth another go once conditions may have changed". Bad URLs and retired model ids
 * answer no to both; an exhausted key answers no to the first and yes to the second.
 */
export function isRecoverableFailure(err: unknown): boolean {
  if (RETRYABLE.includes(classifyError(err))) return true;
  const status = errorHttpStatus(err);
  return status !== undefined && CAPACITY_STATUSES.includes(status);
}

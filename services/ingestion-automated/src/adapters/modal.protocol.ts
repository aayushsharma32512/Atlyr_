/**
 * Pure retry policy for Modal GPU calls. No config, no network — so the rule can be tested
 * without env, and so the reasoning lives somewhere a reader will find it.
 *
 * A Modal request is not a pure read: the Python pipeline writes `ingestion_pipeline_jobs` and
 * `segmentation_jobs` itself, out of band, keyed by the ids in the query string. That makes
 * "just retry it" the wrong default, and makes ONE case genuinely dangerous.
 */
import { errorHttpStatus } from '../utils/retry';

/** Raised when a call exceeded its client-side ceiling. Never retried — see shouldRetryModalCall. */
export class ModalTimeoutError extends Error {
  readonly kind = 'modal_timeout';
  constructor(url: string, timeoutMs: number) {
    super(`Modal request timed out after ${Math.round(timeoutMs / 1000)}s: ${url}`);
    this.name = 'ModalTimeoutError';
  }
}

/** AbortSignal.timeout surfaces as TimeoutError or AbortError depending on runtime. */
export function isModalTimeout(err: unknown): boolean {
  if (err instanceof ModalTimeoutError) return true;
  const name = (err as { name?: unknown })?.name;
  return name === 'TimeoutError' || name === 'AbortError';
}

/**
 * Deliberately narrow: **connection-level failures only.**
 *
 * - **no HTTP status → retry.** DNS failure, connection refused/reset — the request never left
 *   this process, so provably nothing ran and nothing was billed. This is the only case where a
 *   repeat is free, and it does happen (a `getaddrinfo ENOTFOUND` blip was observed 2026-08-19).
 * - **timeout → never retry.** The container is very likely still working on this exact job. A
 *   second request would run it again on a second GPU: double the bill, and two containers racing
 *   to write the same rows.
 * - **any HTTP status, including 5xx → do not retry.** A response means the request reached Modal
 *   and the function ran, so it may already have written `segmentation_jobs` /
 *   `ingestion_pipeline_jobs` rows out of band. Modal errors are rare enough in practice that
 *   retrying here would be untested code guarding a case that does not occur — while carrying a
 *   real double-execution risk against a non-idempotent endpoint. Let the step fail; pg-boss and
 *   the operator's restart path handle it.
 */
export function shouldRetryModalCall(err: unknown): boolean {
  if (isModalTimeout(err)) return false;
  return errorHttpStatus(err) === undefined;
}

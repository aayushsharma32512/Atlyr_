/**
 * The one place a Modal GPU endpoint is called.
 *
 * Both Modal steps (segmentation, placement) POST to a `@modal.fastapi_endpoint` and block until
 * the GPU pipeline finishes — 60–120 s typical, and up to ~800 s observed once container queueing
 * and a cold start are included. Until this adapter existed these were the only network calls in
 * the service with **no timeout and no retry**, which matters more here than anywhere else:
 * pg-boss expiry does NOT cancel a running handler, so a request that never returns holds one of
 * the worker's slots until the process restarts.
 *
 * Retry policy is deliberately narrower than the rest of the service, because a Modal request is
 * not a pure read — the Python writes `ingestion_pipeline_jobs` and `segmentation_jobs` itself,
 * out of band, keyed by the ids in the query string:
 *
 *   - connection-level failure (DNS, refused, reset)  → retry once. The request never left this
 *     process, so nothing ran and nothing was billed.
 *   - **timeout**                                      → do NOT retry. The container is very
 *     likely still working; a second request would run the same job on a second GPU, double the
 *     bill, and have two containers writing the same rows.
 *   - any HTTP response, 4xx or 5xx                    → fail fast. The function ran and may have
 *     written rows already; Modal errors are rare enough that retrying is untested code guarding
 *     a case that does not happen.
 */
import { config } from '../config/index';
import { withRetry } from '../utils/retry';
import { createLogger } from '../utils/logger';
import { isModalTimeout, ModalTimeoutError, shouldRetryModalCall } from './modal.protocol';

export { ModalTimeoutError } from './modal.protocol';

const logger = createLogger({ stage: 'adapter:modal' });

/**
 * A timeout must not fire while a healthy container is still legitimately working. Modal's own
 * function cap is 600 s, and a request can wait on top of that for a container to be scheduled
 * and cold-started — hence a default comfortably above 600 s, while staying far below
 * BOSS_MODAL_STEP_TIMEOUT_SECONDS (5400 s) so the handler fails on its own terms rather than
 * being expired by pg-boss while it still runs.
 */
function timeoutMs(): number {
  return config.MODAL_REQUEST_TIMEOUT_SECONDS * 1000;
}

export interface ModalCallOptions {
  /** For logs — 'segmentation' | 'placement'. */
  label: string;
  /** Query parameters; encoded here so call sites cannot forget to escape a URL. */
  params: Record<string, string>;
}

/**
 * POST to a Modal endpoint and parse its JSON response. Returns the parsed body and the
 * wall-clock duration, which is what the cost accounting bills against.
 */
export async function callModal<T>(
  baseUrl: string,
  { label, params }: ModalCallOptions,
): Promise<{ result: T; durationMs: number }> {
  const query = new URLSearchParams(params).toString();
  const url = `${baseUrl}/?${query}`;
  const start = Date.now();

  const result = await withRetry(
    async () => {
      let res: Response;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(timeoutMs()),
        });
      } catch (err) {
        // Normalise the runtime's abort flavour into one error the retry predicate understands.
        if (isModalTimeout(err)) throw new ModalTimeoutError(url, timeoutMs());
        throw err;
      }

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        const error = new Error(`Modal ${label} request failed (${res.status}): ${body.slice(0, 500)}`);
        (error as Error & { status?: number }).status = res.status;
        throw error;
      }

      return (await res.json()) as T;
    },
    {
      // Two attempts total, and only for the connection-level case above.
      retries: 2,
      backoffMs: 2_000,
      maxBackoffMs: 5_000,
      shouldRetry: shouldRetryModalCall,
      onRetry: (err, attempt, delayMs) =>
        logger.warn(
          { label, attempt, delayMs, error: (err as Error).message },
          'Modal request failed, retrying',
        ),
    },
  );

  return { result, durationMs: Date.now() - start };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface RetryConfig {
  retries: number;
  backoffMs: number;
  // Exponential backoff is capped here so long retry runs don't sleep for minutes.
  maxBackoffMs?: number;
  // Return false to fail fast on non-transient errors (e.g. 400s). Default: retry everything.
  shouldRetry?: (err: unknown) => boolean;
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
}

export async function withRetry<T>(fn: () => Promise<T>, cfg: RetryConfig): Promise<T> {
  let lastErr!: Error;
  for (let attempt = 1; attempt <= cfg.retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e as Error;
      const retryable = cfg.shouldRetry ? cfg.shouldRetry(e) : true;
      if (!retryable || attempt >= cfg.retries) break;
      const exp = cfg.backoffMs * Math.pow(2, attempt - 1);
      const capped = Math.min(exp, cfg.maxBackoffMs ?? Number.MAX_SAFE_INTEGER);
      // Full jitter so concurrent workers don't hammer a recovering upstream in lockstep.
      const delay = capped / 2 + Math.random() * (capped / 2);
      cfg.onRetry?.(e, attempt, Math.round(delay));
      await sleep(delay);
    }
  }
  throw lastErr;
}

// HTTP status of an upstream error, from err.status (GoogleGenerativeAIFetchError et al.)
// or a "[503 Service Unavailable]"-style token in the message.
export function errorHttpStatus(err: unknown): number | undefined {
  const e = err as { status?: unknown; message?: unknown };
  if (typeof e?.status === 'number') return e.status;
  const msg = typeof e?.message === 'string' ? e.message : '';
  const m = msg.match(/\[(\d{3})[ \]]/);
  return m ? Number(m[1]) : undefined;
}

// Transient upstream conditions worth waiting out: overload/rate-limit/server errors,
// plus plain network failures (no HTTP status at all).
export function isTransientUpstreamError(err: unknown): boolean {
  const status = errorHttpStatus(err);
  if (status === undefined) return true;
  return status === 408 || status === 429 || status >= 500;
}

// Upstream-error classification for the multi-route Gemini transport.
//
// The old isTransientUpstreamError lumped 429 in with 5xx, so a rate-limit storm was retried
// in place — per-model retries × the model fallback chain × pg-boss step retries, minutes of
// backoff spent re-asking a project that had just said "stop". These classes exist so the
// router can react differently per kind:
//
//   rate_limited → NEVER retry the same route; pause it (honouring the server's retryDelay)
//                  and move to the next route. A route is a quota pool; its other models
//                  mostly share the project-level cap, so skipping the whole route is correct.
//   transient    → retry in place with jittered backoff (408 / 5xx / plain network failure).
//   not_found    → model id missing/retired on this route; try the next model, not a new route.
//   fatal_input  → 400s: no route or model fixes a bad request. Fail fast.
//
// Pure module — no config import — so it stays testable without the env-validating config.

export type ErrorKind = 'rate_limited' | 'transient' | 'not_found' | 'fatal_input';

// HTTP status of an upstream error: err.status (SDK error classes), or one of the message
// shapes the SDKs and raw fetch wrappers produce — "[503 Service Unavailable]",
// "got status: 429", '"code": 429' (Google JSON error body), "modelname 429: {...}".
export function errorHttpStatus(err: unknown): number | undefined {
  const e = err as { status?: unknown; code?: unknown; message?: unknown };
  if (typeof e?.status === 'number') return e.status;
  if (typeof e?.code === 'number' && e.code >= 100 && e.code < 600) return e.code;
  const msg = typeof e?.message === 'string' ? e.message : '';
  const m =
    msg.match(/\[(\d{3})[ \]]/) ??
    msg.match(/\bstatus:?\s*(\d{3})\b/i) ??
    msg.match(/"code"\s*:\s*(\d{3})\b/) ??
    msg.match(/\s(\d{3}):\s/);
  return m ? Number(m[1]) : undefined;
}

export function classifyError(err: unknown): ErrorKind {
  const status = errorHttpStatus(err);
  if (status === undefined) return 'transient'; // plain network failure — no HTTP response at all
  if (status === 429) return 'rate_limited';
  if (status === 404) return 'not_found';
  // 403 with a quota/rate reason is a rate limit wearing a different status code.
  if (status === 403 && /quota|rate/i.test(messageOf(err))) return 'rate_limited';
  if (status === 408 || status >= 500) return 'transient';
  // 499 CANCELLED is the CLIENT hanging up — here, the SDK's httpOptions.timeout aborting a slow
  // generation (gemini-3-pro-image at 2K runs 104-155s). Nothing about the request is malformed,
  // so the fallback chain is exactly the right response; classifying it fatal_input killed jobs
  // that a sibling model would have served.
  if (status === 499) return 'transient';
  return 'fatal_input';
}

function messageOf(err: unknown): string {
  const m = (err as { message?: unknown })?.message;
  return typeof m === 'string' ? m : '';
}

/**
 * Server-specified wait before retrying, in ms. Bodies carry it three ways:
 * a Google RetryInfo detail (`"retryDelay": "22s"` / `"2.5s"`), Firecrawl's prose form
 * (`please retry after 57s`), or a Retry-After header some SDKs copy onto the error. Returns
 * undefined when the server named no delay — the caller then falls back to its own pause default.
 */
export function extractRetryDelayMs(err: unknown): number | undefined {
  const msg = messageOf(err);

  const retryInfo = msg.match(/retryDelay["'\s:]+(\d+(?:\.\d+)?)s/i);
  if (retryInfo) return Math.ceil(Number(retryInfo[1]) * 1000);

  const prose = msg.match(/retry after (\d+(?:\.\d+)?)\s*s\b/i);
  if (prose) return Math.ceil(Number(prose[1]) * 1000);

  const headers = (err as { headers?: Record<string, string> })?.headers;
  const retryAfter = headers?.['retry-after'] ?? headers?.['Retry-After'];
  if (retryAfter && /^\d+$/.test(retryAfter)) return Number(retryAfter) * 1000;

  return undefined;
}

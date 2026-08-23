import { describe, expect, test } from 'bun:test';
import { classifyError, extractRetryDelayMs, errorHttpStatus } from './error-classify';

function errWith(status: number | undefined, message: string): Error {
  const e = new Error(message) as Error & { status?: number };
  if (status !== undefined) e.status = status;
  return e;
}

describe('classifyError', () => {
  test('429 is rate_limited, never transient', () => {
    expect(classifyError(errWith(429, 'Resource has been exhausted'))).toBe('rate_limited');
  });

  test('429 detected from message when no status field (raw fetch errors)', () => {
    expect(classifyError(new Error('gemini-3-pro-image 429: {"error":{"code":429}}'))).toBe('rate_limited');
  });

  test('403 with quota reason is rate_limited; plain 403 is fatal', () => {
    expect(classifyError(errWith(403, 'Quota exceeded for project'))).toBe('rate_limited');
    expect(classifyError(errWith(403, 'Permission denied on resource'))).toBe('fatal_input');
  });

  test('5xx and 408 are transient', () => {
    expect(classifyError(errWith(503, 'The model is overloaded'))).toBe('transient');
    expect(classifyError(errWith(500, 'Internal error'))).toBe('transient');
    expect(classifyError(errWith(408, 'Request timeout'))).toBe('transient');
  });

  test('plain network failure (no status anywhere) is transient', () => {
    expect(classifyError(new Error('fetch failed: socket hang up'))).toBe('transient');
  });

  test('404 is not_found (next model), 400 is fatal_input (fail fast)', () => {
    expect(classifyError(errWith(404, 'model not found'))).toBe('not_found');
    expect(classifyError(errWith(400, 'Invalid argument: image too large'))).toBe('fatal_input');
  });

  test('499 CANCELLED (client-side timeout abort) is transient, not fatal', () => {
    // Real body from a gemini-3-pro-image call the SDK aborted at its httpOptions.timeout.
    // fatal_input here killed the job AND skipped the fallback chain.
    const body = '{"error":{"code":499,"message":"The operation was cancelled.","status":"CANCELLED"}}';
    expect(classifyError(errWith(499, body))).toBe('transient');
    expect(classifyError(new Error(body))).toBe('transient'); // status only in the message
  });
});

describe('errorHttpStatus', () => {
  test('reads numeric status field', () => {
    expect(errorHttpStatus(errWith(429, 'x'))).toBe(429);
  });

  test('reads [503 Service Unavailable] token from message', () => {
    expect(errorHttpStatus(new Error('[503 Service Unavailable] high demand'))).toBe(503);
  });

  test('reads "got status: 429" style messages (genai SDK)', () => {
    expect(errorHttpStatus(new Error('got status: 429 . Resource exhausted'))).toBe(429);
  });
});

describe('extractRetryDelayMs', () => {
  test('parses RetryInfo retryDelay from a real AI Studio 429 body', () => {
    const msg = '429: {"error":{"code":429,"status":"RESOURCE_EXHAUSTED","details":[{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"22s"}]}}';
    expect(extractRetryDelayMs(new Error(msg))).toBe(22_000);
  });

  test('parses fractional seconds', () => {
    expect(extractRetryDelayMs(new Error('"retryDelay": "2.5s"'))).toBe(2_500);
  });

  test('falls back to Retry-After header when present on the error', () => {
    const e = new Error('429') as Error & { headers?: Record<string, string> };
    e.headers = { 'retry-after': '30' };
    expect(extractRetryDelayMs(e)).toBe(30_000);
  });

  test('parses the prose form from a real Firecrawl 429 body', () => {
    const msg = 'Firecrawl error 429: {"success":false,"error":"Rate limit exceeded. Consumed (req/min): 15, '
      + 'Remaining (req/min): 0. Upgrade your plan at https://firecrawl.dev/pricing for increased rate limits '
      + 'or please retry after 57s, resets at Fri Aug 14 2026 10:14:26 GMT+0000"}';
    expect(extractRetryDelayMs(new Error(msg))).toBe(57_000);
  });

  test('undefined when the server named no delay', () => {
    expect(extractRetryDelayMs(new Error('429: too many requests'))).toBeUndefined();
  });
});

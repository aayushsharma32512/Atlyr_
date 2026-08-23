import { test, expect, describe } from 'bun:test';
import { isModalTimeout, ModalTimeoutError, shouldRetryModalCall } from './modal.protocol';

function httpError(status: number): Error {
  const err = new Error(`Modal request failed (${status})`);
  (err as Error & { status?: number }).status = status;
  return err;
}

function abortLike(name: string): Error {
  const err = new Error('aborted');
  err.name = name;
  return err;
}

describe('isModalTimeout', () => {
  test('recognises both runtime abort flavours and our own error', () => {
    expect(isModalTimeout(new ModalTimeoutError('https://x', 900_000))).toBe(true);
    expect(isModalTimeout(abortLike('TimeoutError'))).toBe(true);
    expect(isModalTimeout(abortLike('AbortError'))).toBe(true);
  });

  test('does not mistake ordinary failures for timeouts', () => {
    expect(isModalTimeout(new Error('ECONNREFUSED'))).toBe(false);
    expect(isModalTimeout(httpError(503))).toBe(false);
    expect(isModalTimeout(null)).toBe(false);
    expect(isModalTimeout(undefined)).toBe(false);
  });
});

describe('shouldRetryModalCall', () => {
  // THE important case. A Modal request is not a pure read: the Python writes the job rows
  // itself. On timeout the container is very likely still working, so a retry would run the same
  // job on a second GPU — double the bill, two containers writing the same rows.
  test('NEVER retries a timeout', () => {
    expect(shouldRetryModalCall(new ModalTimeoutError('https://x', 900_000))).toBe(false);
    expect(shouldRetryModalCall(abortLike('TimeoutError'))).toBe(false);
    expect(shouldRetryModalCall(abortLike('AbortError'))).toBe(false);
  });

  // No HTTP status = the request never reached Modal, so nothing ran and nothing was billed.
  test('retries connection-level failures', () => {
    expect(shouldRetryModalCall(new Error('fetch failed'))).toBe(true);
    expect(shouldRetryModalCall(new Error('getaddrinfo ENOTFOUND'))).toBe(true);
    expect(shouldRetryModalCall(new Error('ECONNRESET'))).toBe(true);
  });

  // Any HTTP response means the function RAN and may already have written its rows out of band.
  // Modal errors are rare in practice, so retrying here would be untested code guarding a case
  // that does not occur, while risking a double execution against a non-idempotent endpoint.
  test('does NOT retry any HTTP response, including 5xx', () => {
    expect(shouldRetryModalCall(httpError(500))).toBe(false);
    expect(shouldRetryModalCall(httpError(502))).toBe(false);
    expect(shouldRetryModalCall(httpError(503))).toBe(false);
    expect(shouldRetryModalCall(httpError(429))).toBe(false);
    expect(shouldRetryModalCall(httpError(400))).toBe(false);
    expect(shouldRetryModalCall(httpError(404))).toBe(false);
  });
});

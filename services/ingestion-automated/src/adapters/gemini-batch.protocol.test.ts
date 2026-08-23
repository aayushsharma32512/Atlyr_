import { test, expect, describe } from 'bun:test';
import {
  CORRELATION_KEY,
  BATCH_DEADLINE_MS,
  errorMessageOf,
  extractImage,
  isPastDeadline,
  isRefusalReason,
  isSpendCapError,
  isTerminalStatus,
  parseJsonlResults,
  readBatchItem,
  resolveJobId,
  shouldFlushTray,
  toBatchStatus,
  toJsonlLine,
  type RawBatchItem,
} from './gemini-batch.protocol';

// ─── Status mapping ──────────────────────────────────────────────────────────

describe('toBatchStatus', () => {
  test('maps the states a healthy tray walks through', () => {
    expect(toBatchStatus('JOB_STATE_PENDING')).toBe('pending');
    expect(toBatchStatus('JOB_STATE_QUEUED')).toBe('pending');
    expect(toBatchStatus('JOB_STATE_RUNNING')).toBe('running');
    expect(toBatchStatus('JOB_STATE_SUCCEEDED')).toBe('succeeded');
  });

  test('treats cancelled as failed so its members fall back like any undelivered tray', () => {
    expect(toBatchStatus('JOB_STATE_CANCELLED')).toBe('failed');
    expect(toBatchStatus('JOB_STATE_FAILED')).toBe('failed');
  });

  test('treats partial success as succeeded — the sweep handles what is missing', () => {
    expect(toBatchStatus('JOB_STATE_PARTIALLY_SUCCEEDED')).toBe('succeeded');
  });

  test('expired is its own status', () => {
    expect(toBatchStatus('JOB_STATE_EXPIRED')).toBe('expired');
  });

  // A terminal misread sweeps live members back to the instant lane and pays twice; reading a
  // finished tray as running costs one extra poll tick. Unknowns must fail in the cheap direction.
  test('unknown, empty and absent states read as running, never terminal', () => {
    expect(toBatchStatus('JOB_STATE_SOMETHING_NEW')).toBe('running');
    expect(toBatchStatus(undefined)).toBe('running');
    expect(toBatchStatus(null)).toBe('running');
    expect(toBatchStatus('')).toBe('running');
    expect(isTerminalStatus(toBatchStatus('JOB_STATE_SOMETHING_NEW'))).toBe(false);
  });

  test('cancelling is still in flight', () => {
    expect(isTerminalStatus(toBatchStatus('JOB_STATE_CANCELLING'))).toBe(false);
  });

  test('every terminal outcome is terminal — not just success', () => {
    expect(isTerminalStatus('succeeded')).toBe(true);
    expect(isTerminalStatus('failed')).toBe(true);
    expect(isTerminalStatus('expired')).toBe(true);
    expect(isTerminalStatus('pending')).toBe(false);
    expect(isTerminalStatus('running')).toBe(false);
    expect(isTerminalStatus('submitting')).toBe(false);
  });
});

describe('isPastDeadline', () => {
  const submitted = '2026-08-18T00:00:00.000Z';
  const t0 = Date.parse(submitted);

  test('holds a tray until the 48h mark and expires it at/after', () => {
    expect(isPastDeadline(submitted, t0 + BATCH_DEADLINE_MS - 1000)).toBe(false);
    expect(isPastDeadline(submitted, t0 + BATCH_DEADLINE_MS)).toBe(true);
    expect(isPastDeadline(submitted, t0 + BATCH_DEADLINE_MS + 60_000)).toBe(true);
  });

  test('an unparseable timestamp never self-expires a tray', () => {
    expect(isPastDeadline('not a date', t0 + BATCH_DEADLINE_MS * 10)).toBe(false);
  });

  test('accepts a Date as well as an ISO string', () => {
    expect(isPastDeadline(new Date(t0), t0 + BATCH_DEADLINE_MS)).toBe(true);
  });
});

// ─── Correlation ─────────────────────────────────────────────────────────────

describe('resolveJobId', () => {
  test('reads the inline path metadata field', () => {
    expect(resolveJobId({ metadata: { [CORRELATION_KEY]: 'job-a' } })).toBe('job-a');
  });

  test('reads the file path key field', () => {
    expect(resolveJobId({ key: 'job-b' })).toBe('job-b');
  });

  test('prefers metadata when a tray somehow carries both', () => {
    expect(resolveJobId({ key: 'job-key', metadata: { [CORRELATION_KEY]: 'job-meta' } })).toBe('job-meta');
  });

  test('trims, and rejects blank or absent values rather than inventing a job', () => {
    expect(resolveJobId({ key: '  job-c  ' })).toBe('job-c');
    expect(resolveJobId({ key: '   ' })).toBeNull();
    expect(resolveJobId({ metadata: { [CORRELATION_KEY]: '' } })).toBeNull();
    expect(resolveJobId({})).toBeNull();
    expect(resolveJobId({ metadata: { other: 'x' } })).toBeNull();
  });
});

// ─── Item classification ─────────────────────────────────────────────────────

function imageItem(jobId: string, data = 'aGVsbG8=', mimeType = 'image/jpeg'): RawBatchItem {
  return {
    metadata: { [CORRELATION_KEY]: jobId },
    response: {
      candidates: [{ content: { parts: [{ inlineData: { mimeType, data } }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 1200, totalTokenCount: 1300 },
    },
  };
}

describe('readBatchItem', () => {
  test('extracts image, mime and usage from a good result', () => {
    const r = readBatchItem(imageItem('job-1'));
    expect(r.outcome).toBe('image');
    if (r.outcome !== 'image') throw new Error('unreachable');
    expect(r.jobId).toBe('job-1');
    expect(r.b64).toBe('aGVsbG8=');
    expect(r.mimeType).toBe('image/jpeg');
    expect(r.usage).toEqual({ prompt_tokens: 100, output_tokens: 1200, total_tokens: 1300 });
  });

  test('an image with no usageMetadata still applies — cost falls back to the flat rate', () => {
    const item = imageItem('job-1');
    delete (item.response as { usageMetadata?: unknown }).usageMetadata;
    const r = readBatchItem(item);
    expect(r.outcome).toBe('image');
    if (r.outcome !== 'image') throw new Error('unreachable');
    expect(r.usage).toBeNull();
  });

  test('skips non-image parts to find the image', () => {
    const item: RawBatchItem = {
      metadata: { [CORRELATION_KEY]: 'job-1' },
      response: {
        candidates: [
          {
            content: {
              parts: [
                { inlineData: null },
                {},
                { inlineData: { mimeType: 'image/png', data: 'Zm9v' } },
              ],
            },
          },
        ],
      },
    };
    const r = readBatchItem(item);
    if (r.outcome !== 'image') throw new Error(`expected image, got ${r.outcome}`);
    expect(r.b64).toBe('Zm9v');
    expect(r.mimeType).toBe('image/png');
  });

  // Per-item errors must stay per-item: one bad result cannot cost the other 29 their batch price.
  test('a per-item error is an error against that job, not a tray failure', () => {
    const r = readBatchItem({
      metadata: { [CORRELATION_KEY]: 'job-2' },
      error: { code: 400, status: 'INVALID_ARGUMENT', message: 'bad request' },
    });
    if (r.outcome !== 'error') throw new Error(`expected error, got ${r.outcome}`);
    expect(r.jobId).toBe('job-2');
    expect(r.error).toContain('INVALID_ARGUMENT');
    expect(r.error).toContain('bad request');
    expect(r.refusal).toBe(false);
  });

  test('a safety refusal is flagged as a refusal so the tax can be measured', () => {
    const r = readBatchItem({
      metadata: { [CORRELATION_KEY]: 'job-3' },
      response: { candidates: [{ content: { parts: [] }, finishReason: 'IMAGE_SAFETY' }] },
    });
    if (r.outcome !== 'error') throw new Error(`expected error, got ${r.outcome}`);
    expect(r.refusal).toBe(true);
    expect(r.error).toContain('IMAGE_SAFETY');
  });

  test('a prompt-level block reads as a refusal too', () => {
    const r = readBatchItem({
      metadata: { [CORRELATION_KEY]: 'job-4' },
      response: { candidates: [{ finishReason: 'OTHER' }], promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } },
    });
    if (r.outcome !== 'error') throw new Error(`expected error, got ${r.outcome}`);
    expect(r.refusal).toBe(true);
    expect(r.error).toContain('PROHIBITED_CONTENT');
  });

  test('a truncated response is an error but not a refusal', () => {
    const r = readBatchItem({
      metadata: { [CORRELATION_KEY]: 'job-5' },
      response: { candidates: [{ content: { parts: [] }, finishReason: 'MAX_TOKENS' }] },
    });
    if (r.outcome !== 'error') throw new Error(`expected error, got ${r.outcome}`);
    expect(r.refusal).toBe(false);
  });

  test('an empty response with no reason at all is still attributable to its job', () => {
    const r = readBatchItem({ metadata: { [CORRELATION_KEY]: 'job-6' }, response: {} });
    if (r.outcome !== 'error') throw new Error(`expected error, got ${r.outcome}`);
    expect(r.jobId).toBe('job-6');
    expect(r.error).toContain('unknown');
  });

  // Nothing may be routed by position: a result without a key has no job, full stop.
  test('an item with no correlation value is uncorrelated, never guessed at', () => {
    const r = readBatchItem({ response: { candidates: [{ content: { parts: [{ inlineData: { data: 'x' } }] } }] } });
    expect(r.outcome).toBe('uncorrelated');
    if (r.outcome !== 'uncorrelated') throw new Error('unreachable');
    expect(r.error).toContain(CORRELATION_KEY);
  });
});

describe('extractImage', () => {
  test('returns null for absent, empty and dataless responses', () => {
    expect(extractImage(null)).toBeNull();
    expect(extractImage(undefined)).toBeNull();
    expect(extractImage({})).toBeNull();
    expect(extractImage({ candidates: [] })).toBeNull();
    expect(extractImage({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png' } }] } }] })).toBeNull();
  });

  test('defaults a missing mime type rather than dropping the image', () => {
    expect(extractImage({ candidates: [{ content: { parts: [{ inlineData: { data: 'eA==' } }] } }] })).toEqual({
      b64: 'eA==',
      mimeType: 'image/png',
    });
  });
});

describe('isRefusalReason', () => {
  test('separates declines from failures', () => {
    expect(isRefusalReason('SAFETY')).toBe(true);
    expect(isRefusalReason('IMAGE_SAFETY')).toBe(true);
    expect(isRefusalReason('RECITATION')).toBe(true);
    expect(isRefusalReason('STOP')).toBe(false);
    expect(isRefusalReason('MAX_TOKENS')).toBe(false);
    expect(isRefusalReason(null)).toBe(false);
    expect(isRefusalReason(undefined)).toBe(false);
  });
});

// ─── JSONL transport ─────────────────────────────────────────────────────────

describe('JSONL transport', () => {
  test('a line carries the key beside its request', () => {
    expect(JSON.parse(toJsonlLine('job-1', { contents: [] }))).toEqual({ key: 'job-1', request: { contents: [] } });
  });

  test('parses lines, ignoring blanks and trailing newlines', () => {
    const text = `{"key":"a","response":{}}\n\n  \n{"key":"b","response":{}}\n`;
    const items = parseJsonlResults(text);
    expect(items.map((i) => i.key)).toEqual(['a', 'b']);
  });

  // One unparseable line must not cost the rest of the tray its results.
  test('an unparseable line becomes an error item instead of throwing', () => {
    const items = parseJsonlResults(`{"key":"a","response":{}}\nnot json\n{"key":"c","response":{}}`);
    expect(items).toHaveLength(3);
    expect(items[0].key).toBe('a');
    expect(items[1].error?.message).toContain('unparseable');
    expect(items[2].key).toBe('c');
    expect(readBatchItem(items[1]).outcome).toBe('uncorrelated');
  });

  test('round-trips a key through to a resolved job id', () => {
    const [item] = parseJsonlResults(toJsonlLine('job-42', { contents: [] }));
    expect(resolveJobId(item)).toBe('job-42');
  });
});

// ─── Spend cap ───────────────────────────────────────────────────────────────

describe('isSpendCapError', () => {
  // Both arrive as 429 and want opposite reactions: back off vs. stop submitting entirely.
  test('recognises spend-cap wordings', () => {
    expect(isSpendCapError(new Error('429 Too Many Requests: monthly spend limit reached'))).toBe(true);
    expect(isSpendCapError(new Error('You have exceeded your monthly budget for this project'))).toBe(true);
    expect(isSpendCapError('Billing cap exceeded for the Gemini API'))
      .toBe(true);
    expect(isSpendCapError({ error: { message: 'project spending cap has been reached' } })).toBe(true);
  });

  test('does not mistake an ordinary rate limit for a spend cap', () => {
    expect(isSpendCapError(new Error('429 RESOURCE_EXHAUSTED: Quota exceeded for requests per minute'))).toBe(false);
    expect(isSpendCapError(new Error('503 Service Unavailable: model is overloaded'))).toBe(false);
    expect(isSpendCapError(null)).toBe(false);
    expect(isSpendCapError(undefined)).toBe(false);
  });
});

describe('errorMessageOf', () => {
  test('reads a message off the shapes the SDK and wire actually produce', () => {
    expect(errorMessageOf(new Error('boom'))).toBe('boom');
    expect(errorMessageOf('boom')).toBe('boom');
    expect(errorMessageOf({ message: 'boom' })).toBe('boom');
    expect(errorMessageOf({ error: { message: 'boom' } })).toBe('boom');
    expect(errorMessageOf(null)).toBe('');
    expect(errorMessageOf(undefined)).toBe('');
  });
});

// ─── Flush decision ──────────────────────────────────────────────────────────

describe('shouldFlushTray', () => {
  const base = { minFill: 10, maxWaitSeconds: 900 };

  test('ships a full tray immediately', () => {
    expect(shouldFlushTray({ ...base, waiting: 10, oldestAgeSeconds: 5 })).toEqual({ flush: true, trigger: 'full' });
    expect(shouldFlushTray({ ...base, waiting: 30, oldestAgeSeconds: 0 })).toEqual({ flush: true, trigger: 'full' });
  });

  // The bug this exists to prevent: a cron tick is permission to consider a tray, not to send one.
  // Shipping on every tick turned a slow arrival rate into a stream of one- and two-item batches.
  test('holds a part-full tray that has not waited long', () => {
    expect(shouldFlushTray({ ...base, waiting: 1, oldestAgeSeconds: 30 })).toEqual({ flush: false, trigger: 'none' });
    expect(shouldFlushTray({ ...base, waiting: 9, oldestAgeSeconds: 899 })).toEqual({ flush: false, trigger: 'none' });
  });

  // ...but a trickle must never be stranded below the fill line forever.
  test('ships a part-full tray once its oldest member has waited too long', () => {
    expect(shouldFlushTray({ ...base, waiting: 1, oldestAgeSeconds: 900 })).toEqual({ flush: true, trigger: 'max-wait' });
    expect(shouldFlushTray({ ...base, waiting: 3, oldestAgeSeconds: 5000 })).toEqual({ flush: true, trigger: 'max-wait' });
  });

  test('never ships an empty tray, however long the clock says', () => {
    expect(shouldFlushTray({ ...base, waiting: 0, oldestAgeSeconds: 99999 })).toEqual({ flush: false, trigger: 'none' });
  });

  test('minFill of 1 restores ship-on-every-tick for anyone who wants it', () => {
    expect(shouldFlushTray({ waiting: 1, oldestAgeSeconds: 0, minFill: 1, maxWaitSeconds: 900 }))
      .toEqual({ flush: true, trigger: 'full' });
  });
});

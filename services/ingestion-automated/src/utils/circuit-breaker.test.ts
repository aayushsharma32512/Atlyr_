import { describe, expect, test } from 'bun:test';
import { CircuitBreaker } from './circuit-breaker';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('CircuitBreaker', () => {
  test('opens after the failure threshold and blocks callers', () => {
    const cb = new CircuitBreaker(3, 10_000);
    expect(cb.canPass('k')).toBe(true);
    cb.reportFailure('k');
    cb.reportFailure('k');
    expect(cb.canPass('k')).toBe(true);  // below threshold
    cb.reportFailure('k');
    expect(cb.canPass('k')).toBe(false); // open
  });

  test('success resets the failure count', () => {
    const cb = new CircuitBreaker(3, 10_000);
    cb.reportFailure('k');
    cb.reportFailure('k');
    cb.reportSuccess('k');
    cb.reportFailure('k');
    cb.reportFailure('k');
    expect(cb.canPass('k')).toBe(true); // streak broken — still closed
  });

  test('half-opens after cooldown: one probe only; success closes, failure re-opens', async () => {
    const cb = new CircuitBreaker(1, 30);
    cb.reportFailure('k');
    expect(cb.canPass('k')).toBe(false);

    await sleep(40);
    expect(cb.canPass('k')).toBe(true);  // the probe
    expect(cb.canPass('k')).toBe(false); // only one probe until it reports

    cb.reportFailure('k');               // probe failed → re-open
    expect(cb.canPass('k')).toBe(false);

    await sleep(40);
    expect(cb.canPass('k')).toBe(true);
    cb.reportSuccess('k');               // probe succeeded → closed
    expect(cb.canPass('k')).toBe(true);
    expect(cb.canPass('k')).toBe(true);
  });

  test('explicit openForMs opens immediately regardless of threshold (the 429 case)', () => {
    const cb = new CircuitBreaker(5, 10_000);
    cb.reportFailure('k', 10_000);
    expect(cb.canPass('k')).toBe(false);
  });

  test('keys are independent', () => {
    const cb = new CircuitBreaker(1, 10_000);
    cb.reportFailure('a');
    expect(cb.canPass('a')).toBe(false);
    expect(cb.canPass('b')).toBe(true);
  });

  test('a probe that never reports back re-arms after the cooldown instead of wedging the key', async () => {
    // The router's sweep can consume the probe and then make no attempt (every pool busy) or end
    // in kinds that never report (refused/not_found). Without re-arm, halfOpen stays true forever
    // and the key is closed for the life of the process.
    const cb = new CircuitBreaker(1, 30);
    cb.reportFailure('k');
    await sleep(40);
    expect(cb.canPass('k')).toBe(true);  // probe consumed…
    expect(cb.canPass('k')).toBe(false); // …and not reported
    await sleep(40);                     // cooldown passes with no report
    expect(cb.canPass('k')).toBe(true);  // re-armed — key is not dead
  });

  test('refundProbe gives an unused probe back immediately', async () => {
    const cb = new CircuitBreaker(1, 30);
    cb.reportFailure('k');
    await sleep(40);
    expect(cb.canPass('k')).toBe(true);  // probe taken
    expect(cb.canPass('k')).toBe(false);
    cb.refundProbe('k');                 // walk made zero attempts — hand it back
    expect(cb.canPass('k')).toBe(true);  // next caller may probe right away
  });
});

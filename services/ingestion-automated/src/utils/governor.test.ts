import { describe, expect, test } from 'bun:test';
import { Governor } from './governor';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Governor', () => {
  test('caps in-flight calls at the limit and queues the rest', async () => {
    const gov = new Governor();
    gov.setLimit('k', 2);

    let inFlight = 0;
    let peak = 0;
    const job = () =>
      gov.acquire('k', async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await sleep(20);
        inFlight -= 1;
      });

    await Promise.all([job(), job(), job(), job(), job()]);
    expect(peak).toBe(2);
  });

  test('rate limit halves the effective limit once per congestion event', async () => {
    const gov = new Governor();
    gov.setLimit('k', 8);
    gov.reportRateLimit('k', 5);
    expect(gov.limitOf('k')).toBe(4);
    await sleep(10); // pause lapses — a NEW 429 is a new congestion event
    gov.reportRateLimit('k', 5);
    expect(gov.limitOf('k')).toBe(2);
    await sleep(10);
    gov.reportRateLimit('k', 5);
    await sleep(10);
    gov.reportRateLimit('k', 5);
    expect(gov.limitOf('k')).toBe(1); // floor at 1, never 0
  });

  test('429s landing inside an active pause extend it but do not halve again', () => {
    // When a pause lapses, up to `limit` parked callers can fire together and all get rejected;
    // halving per response collapsed 8 -> 1 for one congestion signal.
    const gov = new Governor();
    gov.setLimit('k', 8);
    gov.reportRateLimit('k', 60_000); // first 429 of the event: halves and arms the pause
    gov.reportRateLimit('k', 60_000); // herd members inside the window
    gov.reportRateLimit('k', 60_000);
    expect(gov.limitOf('k')).toBe(4); // one halving, not three
    expect(gov.isPaused('k')).toBe(true);
  });

  test('pauses issuance for the retryDelay then resumes', async () => {
    const gov = new Governor();
    gov.setLimit('k', 4);
    gov.reportRateLimit('k', 50);
    expect(gov.isPaused('k')).toBe(true);

    const start = Date.now();
    await gov.acquire('k', async () => {});
    expect(Date.now() - start).toBeGreaterThanOrEqual(40);
    expect(gov.isPaused('k')).toBe(false);
  });

  test('sustained success recovers the limit toward the ceiling', async () => {
    const gov = new Governor();
    gov.setLimit('k', 8);
    gov.reportRateLimit('k', 1);
    expect(gov.limitOf('k')).toBe(4);
    await sleep(5); // let the pause lapse

    for (let i = 0; i < 10; i++) await gov.acquire('k', async () => {});
    expect(gov.limitOf('k')).toBe(5); // +1 after 10 successes

    for (let i = 0; i < 10; i++) await gov.acquire('k', async () => {});
    expect(gov.limitOf('k')).toBe(6);
  });

  test('a failing fn releases its slot', async () => {
    const gov = new Governor();
    gov.setLimit('k', 1);
    await expect(gov.acquire('k', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    // Slot must be free again or this would hang.
    await gov.acquire('k', async () => {});
  });

  test('keys are independent', async () => {
    const gov = new Governor();
    gov.setLimit('a', 1);
    gov.setLimit('b', 1);
    gov.reportRateLimit('a', 10_000);
    // 'b' is unaffected by 'a' being paused.
    await gov.acquire('b', async () => {});
    expect(gov.isPaused('a')).toBe(true);
    expect(gov.isPaused('b')).toBe(false);
  });

  test('a rate limit throttles only its own pool, not a sibling', async () => {
    // The Gemini keys are route+model, so a saturated pro pool must leave the flash pool beside it
    // at full concurrency — throttling the sibling is what turned a 21s call into 108s.
    const gov = new Governor();
    gov.setLimit('vertex:global::pro', 8);
    gov.setLimit('vertex:global::flash', 8);

    gov.reportRateLimit('vertex:global::pro', 15_000);
    gov.reportRateLimit('vertex:global::pro', 15_000); // same congestion event — no second halve

    expect(gov.limitOf('vertex:global::pro')).toBe(4);
    expect(gov.limitOf('vertex:global::flash')).toBe(8);
    expect(gov.isPaused('vertex:global::flash')).toBe(false);
  });

  test('setDefaultLimit applies to keys seen afterwards', () => {
    const gov = new Governor();
    gov.setDefaultLimit(3);
    expect(gov.limitOf('fresh-key')).toBe(3);
  });

  test('tryAcquire runs on a free slot and returns the value', async () => {
    const gov = new Governor();
    const out = await gov.tryAcquire('k', async () => 42);
    expect(out).toEqual({ acquired: true, value: 42 });
  });

  test('tryAcquire refuses without waiting when the pool is paused', async () => {
    const gov = new Governor();
    gov.reportRateLimit('k', 60_000);
    const t = Date.now();
    const out = await gov.tryAcquire('k', async () => 42);
    expect(out).toEqual({ acquired: false, reason: 'paused' });
    expect(Date.now() - t).toBeLessThan(500); // must not sleep out the 60s pause
  });

  test('tryAcquire refuses without waiting when every slot is taken', async () => {
    const gov = new Governor();
    gov.setLimit('k', 1);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const holder = gov.acquire('k', () => gate);

    const out = await gov.tryAcquire('k', async () => 42);
    expect(out).toEqual({ acquired: false, reason: 'saturated' });

    release();
    await holder;
    // Slot freed — admits again.
    expect(await gov.tryAcquire('k', async () => 7)).toEqual({ acquired: true, value: 7 });
  });

  test('tryAcquire releases its slot when fn throws, and the error propagates', async () => {
    const gov = new Governor();
    gov.setLimit('k', 1);
    await expect(gov.tryAcquire('k', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    // A leaked slot would make this refuse.
    expect(await gov.tryAcquire('k', async () => 1)).toEqual({ acquired: true, value: 1 });
  });
});

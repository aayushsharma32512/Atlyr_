import { describe, expect, test } from 'bun:test';
import { resolvePerKeyLimits } from './per-key-limits';

describe('per-key concurrency limits', () => {
  test('a single value applies to every key — existing .env files keep working', () => {
    expect(resolvePerKeyLimits('3', 4, 3)).toEqual([3, 3, 3, 3]);
  });

  // The case that motivated this: paid key allows 5, free key allows 2 (measured 2026-09-13).
  test('a per-key list is honoured in key priority order', () => {
    expect(resolvePerKeyLimits('5,2', 2, 3)).toEqual([5, 2]);
  });

  test('a short list carries its last value rather than reverting to the default', () => {
    expect(resolvePerKeyLimits('5,2', 4, 3)).toEqual([5, 2, 2, 2]);
  });

  test('extra entries beyond the key count are ignored', () => {
    expect(resolvePerKeyLimits('5,2,9,9', 2, 3)).toEqual([5, 2]);
  });

  test('an empty spec falls back for every key', () => {
    expect(resolvePerKeyLimits('', 3, 3)).toEqual([3, 3, 3]);
  });

  // A 0 would wedge the pool permanently shut and NaN would remove the bound entirely — both are
  // worse than the default, so a malformed entry must not pass through.
  test('malformed, zero and negative entries fall back instead of wedging or unbounding a pool', () => {
    expect(resolvePerKeyLimits('abc,0,-4', 3, 3)).toEqual([3, 3, 3]);
  });

  test('no key means no limits', () => {
    expect(resolvePerKeyLimits('5,2', 0, 3)).toEqual([]);
  });
});

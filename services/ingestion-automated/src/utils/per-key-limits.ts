/**
 * Per-key concurrency limits.
 *
 * `FIRECRAWL_MAX_CONCURRENCY` was a single number applied to every key pool, which is wrong in both
 * directions once the keys are on different plans. Measured 2026-09-13: the paid key allows 5
 * in-flight requests, the free one allows 2, and we were sending 3 to both — starving the key we
 * pay for while pushing the free key past its limit into the 429s that park it. Parking a key is
 * what strands jobs, so this is a correctness fix, not a throughput tweak.
 *
 * Spec mirrors FIRECRAWL_API_KEY: comma-separated, in the same priority order as the keys.
 * A single value still applies to every key, so existing .env files keep working.
 *
 * Pure — no config import — so it is testable without the env-validating config (see CLAUDE.md).
 */
export function resolvePerKeyLimits(spec: string, keyCount: number, fallback: number): number[] {
  const parsed = (spec ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const n = Number(part);
      // A malformed entry must not silently become 0 (which would wedge the pool shut) or NaN
      // (which compares false against every limit, removing the bound entirely).
      return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
    });

  if (parsed.length === 0) return Array.from({ length: keyCount }, () => fallback);

  // Fewer entries than keys: the last one carries, so `3` means "3 for all" and `5,2` on three keys
  // means the third key shares the second's limit rather than silently reverting to the default.
  return Array.from({ length: keyCount }, (_unused, i) => parsed[i] ?? parsed[parsed.length - 1]!);
}

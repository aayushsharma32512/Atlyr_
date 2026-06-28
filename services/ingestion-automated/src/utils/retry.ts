const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function withRetry<T>(
  fn: () => Promise<T>,
  cfg: { retries: number; backoffMs: number }
): Promise<T> {
  let lastErr!: Error;
  for (let attempt = 1; attempt <= cfg.retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e as Error;
      if (attempt < cfg.retries) {
        await sleep(cfg.backoffMs * Math.pow(2, attempt - 1));
      }
    }
  }
  throw lastErr;
}

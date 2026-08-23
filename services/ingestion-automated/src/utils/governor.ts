// Per-route concurrency governor with AIMD backpressure.
//
// acquire(key, fn) runs fn under the named key's concurrency budget: at most `limit` calls in
// flight, the rest queued FIFO. On a rate-limit signal the effective limit HALVES and the key
// pauses for the server-supplied delay (additive-increase/multiplicative-decrease — the same
// idea TCP uses): a static cap is either wasted headroom or still gets 429s, and under Vertex's
// dynamic shared quota there is no published number to configure anyway. Sustained successes
// walk the limit back up one slot at a time.
//
// Wake-up discipline (deliberate — a previous version deadlocked here): a paused caller SLEEPS
// through the remaining pause itself and re-checks; the queue is only for slot contention, and
// every release drains it unconditionally. Waiters woken mid-pause simply re-enter the pause
// sleep. This keeps the design free of background timers (an unref'd resume timer never fires
// under Bun once it is the only pending handle).
//
// Pure module — no config import — so it stays testable without the env-validating config.

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Waiter = () => void;

interface KeyState {
  limit: number;         // current effective concurrency
  maxLimit: number;      // ceiling the limit recovers toward
  inFlight: number;
  queue: Waiter[];       // slot-contention waiters only
  pausedUntil: number;   // epoch ms; 0 = not paused
  successStreak: number;
}

const DEFAULT_MAX = 8;
const DEFAULT_PAUSE_MS = 15_000;      // when the server named no retryDelay
const RECOVER_EVERY_N_SUCCESSES = 10; // additive increase cadence

export class Governor {
  private keys = new Map<string, KeyState>();

  constructor(private defaultMax: number = DEFAULT_MAX) {}

  /** Ceiling applied to keys seen for the first time. Set once at wiring time. */
  setDefaultLimit(maxLimit: number): void {
    this.defaultMax = Math.max(1, maxLimit);
  }

  private state(key: string): KeyState {
    let s = this.keys.get(key);
    if (!s) {
      s = { limit: this.defaultMax, maxLimit: this.defaultMax, inFlight: 0, queue: [], pausedUntil: 0, successStreak: 0 };
      this.keys.set(key, s);
    }
    return s;
  }

  /** Set the concurrency ceiling for a key. Also clamps the current limit into [1, ceiling]. */
  setLimit(key: string, maxLimit: number): void {
    const s = this.state(key);
    s.maxLimit = Math.max(1, maxLimit);
    s.limit = Math.min(Math.max(s.limit, 1), s.maxLimit);
    this.drain(key);
  }

  /**
   * Halve the key's concurrency and pause issuance — the 429 reaction.
   *
   * Both effects land on the same key because a key IS one capacity pool. Callers must key by the
   * thing that actually runs out: for Gemini that is route+model (Vertex serves each model from its
   * own Dynamic Shared Quota pool, so a saturated gemini-3-pro-image must neither pause nor throttle
   * gemini-3.1-flash-image beside it — measured at 21s while pro was returning 429s).
   */
  reportRateLimit(key: string, retryDelayMs?: number): void {
    const s = this.state(key);
    // Halve once per congestion EVENT, not once per 429 response. When a pause lapses, up to
    // `limit` parked callers fire near-simultaneously and can all get rejected; halving for each
    // collapses 8 -> 1 for what AIMD treats as a single congestion signal (TCP halves once per
    // congestion window, not once per lost segment). The first 429 of the event halves and arms
    // the pause; later 429s landing inside the pause only extend it.
    if (Date.now() >= s.pausedUntil) {
      s.limit = Math.max(1, Math.floor(s.limit / 2));
    }
    s.successStreak = 0;
    const until = Date.now() + (retryDelayMs ?? DEFAULT_PAUSE_MS);
    if (until > s.pausedUntil) s.pausedUntil = until;
  }

  /** Sustained success walks the limit back toward the ceiling, one slot per N successes. */
  private reportSuccess(key: string): void {
    const s = this.state(key);
    s.successStreak += 1;
    if (s.successStreak >= RECOVER_EVERY_N_SUCCESSES && s.limit < s.maxLimit) {
      s.limit += 1;
      s.successStreak = 0;
      this.drain(key);
    }
  }

  /** Current effective limit — exposed for logging/tests. */
  limitOf(key: string): number {
    return this.state(key).limit;
  }

  isPaused(key: string): boolean {
    return this.state(key).pausedUntil > Date.now();
  }

  /**
   * How much of this pool's pause is left, in ms (0 when not paused).
   *
   * `tryAcquire` reports THAT a pool is paused but not for how long, so a caller with no free pool
   * had to guess at a backoff — and guessing ~1s against a server that asked for 57 burned every
   * retry inside the paused window. Callers that defer work rather than failing it need the real
   * number.
   */
  pauseRemainingMs(key: string): number {
    return Math.max(0, this.state(key).pausedUntil - Date.now());
  }

  /**
   * Non-blocking acquire: runs fn only if the key is unpaused and has a free slot RIGHT NOW,
   * otherwise reports why without waiting. For callers that have alternatives — the router's
   * model chain — where a busy pool should mean "try the next model", not "sleep in this pool's
   * queue". Blocking acquire() serialized 12 workers behind one saturated model's pool (limit
   * halved to 1 by 429s), inflating 21s VTON calls to 1400s of queue wait.
   *
   * A rejection from fn propagates to the caller — `acquired: false` is only ever a no-attempt.
   */
  async tryAcquire<T>(
    key: string,
    fn: () => Promise<T>,
  ): Promise<{ acquired: true; value: T } | { acquired: false; reason: 'paused' | 'saturated' }> {
    const s = this.state(key);
    if (s.pausedUntil > Date.now()) return { acquired: false, reason: 'paused' };
    if (s.inFlight >= s.limit) return { acquired: false, reason: 'saturated' };

    s.inFlight += 1;
    try {
      const value = await fn();
      this.reportSuccess(key);
      return { acquired: true, value };
    } finally {
      s.inFlight -= 1;
      this.drain(key);
    }
  }

  async acquire<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const s = this.state(key);

    for (;;) {
      const pauseLeft = s.pausedUntil - Date.now();
      if (pauseLeft > 0) {
        await sleep(pauseLeft);
        continue;
      }
      if (s.inFlight >= s.limit) {
        await new Promise<void>((resolve) => s.queue.push(resolve));
        continue;
      }
      break;
    }

    s.inFlight += 1;
    try {
      const result = await fn();
      this.reportSuccess(key);
      return result;
    } finally {
      s.inFlight -= 1;
      this.drain(key);
    }
  }

  // Wake as many slot-waiters as there are free slots. Runs on every release — even during a
  // pause, because a waiter woken mid-pause just re-enters the pause sleep, whereas NOT waking
  // it here could strand it forever (the last in-flight release is the final wake-up call).
  private drain(key: string): void {
    const s = this.state(key);
    let free = s.limit - s.inFlight;
    while (free > 0 && s.queue.length > 0) {
      s.queue.shift()!();
      free -= 1;
    }
  }
}

// Shared instance for the service; tests construct their own.
export const governor = new Governor();

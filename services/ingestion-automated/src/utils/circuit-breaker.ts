// Per-key circuit breaker for upstream routes.
//
// After K consecutive failures a key OPENS: canPass() returns false and callers skip it
// without paying a timeout. After the cooldown it half-opens — the next caller is let
// through as a probe; success closes the breaker, failure re-opens it for another cooldown.
// A rate-limit failure can pass its server-supplied retryDelay as the cooldown so the route
// stays closed exactly as long as the provider asked.
//
// Pure module — no config import — so it stays testable without the env-validating config.

interface BreakerState {
  consecutiveFailures: number;
  openUntil: number;      // epoch ms; 0 = closed
  halfOpen: boolean;      // one probe allowed after cooldown expires
  probeGrantedAt: number; // when the outstanding half-open probe was handed out
}

const DEFAULT_THRESHOLD = 5;
const DEFAULT_COOLDOWN_MS = 30_000;

export class CircuitBreaker {
  private keys = new Map<string, BreakerState>();

  constructor(
    private threshold: number = DEFAULT_THRESHOLD,
    private cooldownMs: number = DEFAULT_COOLDOWN_MS,
  ) {}

  private state(key: string): BreakerState {
    let s = this.keys.get(key);
    if (!s) {
      s = { consecutiveFailures: 0, openUntil: 0, halfOpen: false, probeGrantedAt: 0 };
      this.keys.set(key, s);
    }
    return s;
  }

  canPass(key: string): boolean {
    const s = this.state(key);
    if (s.openUntil === 0) return true;
    if (Date.now() < s.openUntil) return false;
    // Cooldown expired — allow one probe until it reports back.
    if (!s.halfOpen) {
      s.halfOpen = true;
      s.probeGrantedAt = Date.now();
      return true;
    }
    // A probe is not a promise to report: the router's sweep can consume canPass and then make
    // zero real attempts (every pool paused/saturated) or end the walk in kinds that never touch
    // the breaker (refused, not_found). Waiting on that report forever wedges the key CLOSED for
    // the life of the process. Re-arm after a cooldown so an unreported probe is merely lost time.
    if (Date.now() - s.probeGrantedAt >= this.cooldownMs) {
      s.probeGrantedAt = Date.now();
      return true;
    }
    return false;
  }

  /**
   * Give back a canPass() probe that produced no attempt at all, so the NEXT caller may probe
   * immediately instead of everyone waiting out the re-arm window.
   */
  refundProbe(key: string): void {
    const s = this.state(key);
    if (s.halfOpen) s.halfOpen = false;
  }

  reportSuccess(key: string): void {
    const s = this.state(key);
    s.consecutiveFailures = 0;
    s.openUntil = 0;
    s.halfOpen = false;
  }

  /** openForMs forces an immediate open for that duration (the rate-limit case). */
  reportFailure(key: string, openForMs?: number): void {
    const s = this.state(key);
    s.consecutiveFailures += 1;
    if (openForMs !== undefined) {
      s.openUntil = Date.now() + openForMs;
      s.halfOpen = false;
      return;
    }
    if (s.halfOpen || s.consecutiveFailures >= this.threshold) {
      s.openUntil = Date.now() + this.cooldownMs;
      s.halfOpen = false;
    }
  }

  isOpen(key: string): boolean {
    const s = this.state(key);
    return s.openUntil !== 0 && Date.now() < s.openUntil;
  }
}

// Shared instance for the service; tests construct their own.
export const routeBreaker = new CircuitBreaker();

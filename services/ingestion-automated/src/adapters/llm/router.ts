// Route-walking core of the multi-route Gemini transport.
//
// One call = sweep routes in priority order; within a route, sweep the model fallback chain.
// A pool (route+model) that is paused or has no free slot is SKIPPED, not waited on — whichever
// pool frees first serves the call. Only when a whole sweep finds nothing but busy pools does the
// call pause briefly and sweep again. The error class decides the move (see utils/error-classify.ts):
//
//   rate_limited → tell the governor (AIMD halve + pause the POOL), then try the NEXT MODEL.
//                  Capacity is per-model, not per-project: Vertex serves gemini-*-image through
//                  Dynamic Shared Quota, where an exhausted pool for gemini-3-pro-image says
//                  nothing about gemini-3.1-flash-image (measured: pro 429s while both flash
//                  models serve in 6-13s). Rate limits never touch the route breaker — the pool
//                  pause is the right scope, and the route is shared by the text model family.
//   transient    → withRetry in place (jittered backoff) unless timeout-shaped (499/504), then
//                  the NEXT MODEL; the pool is done for this call after that.
//   not_found    → model id absent on this route — NEXT MODEL, no penalty.
//   fatal_input  → nothing downstream fixes a bad request — throw immediately.
//
// Every attempt is recorded and returned so handlers can persist `attempted` on artifacts —
// a 429 storm should be visible in the dashboard afterwards, not silently absorbed.
//
// Pure module: routes, transport, governor and breaker are all injected. The config-wired
// singleton lives in ./index.ts.

import { withRetry } from '../../utils/retry';
import { classifyError, errorHttpStatus, extractRetryDelayMs, type ErrorKind } from '../../utils/error-classify';
import type { Governor } from '../../utils/governor';
import type { CircuitBreaker } from '../../utils/circuit-breaker';
import type { LlmRoute } from './route-spec';

// Loose request/response shapes — the transport owns the SDK types; the router only routes.
export interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

export interface GeminiRequest {
  /** Model fallback chain, tried in order per route. */
  models: string[];
  parts: GeminiPart[];
  systemInstruction?: string;
  generationConfig?: Record<string, unknown>;
  /**
   * The response MUST contain an inline image. A 200 with no image part (safety filter,
   * IMAGE_OTHER) then counts as a 'refused' failure and walks the model/route chain, instead of
   * passing through as a "success" the caller can only throw on. Safety refusals are partly
   * model- and endpoint-specific, so the next model or route often produces the image.
   */
  expectImage?: boolean;
}

/** A 200 response that declined to produce the expected image (e.g. finishReason=IMAGE_SAFETY). */
export class ModelRefusedError extends Error {
  constructor(public finishReason: string) {
    super(`model refused to produce an image (finishReason=${finishReason})`);
  }
}

export interface GeminiResponse {
  parts: GeminiPart[];
  usageMetadata?: Record<string, number>;
  finishReason?: string;
}

export interface RouteAttempt {
  route: string;
  model: string;
  errorKind: ErrorKind | 'refused';
  ms: number;
  message: string;
}

export interface GeminiCallResult {
  response: GeminiResponse;
  routeUsed: string;
  modelUsed: string;
  attempted: RouteAttempt[];
}

/** Executes one request against one route+model. Provided by the transport (or a test fake). */
export type RouteTransport = (route: LlmRoute, model: string, req: GeminiRequest) => Promise<GeminiResponse>;

export class AllRoutesFailedError extends Error {
  constructor(public attempted: RouteAttempt[], cause?: unknown) {
    const summary = attempted.map((a) => `${a.route}/${a.model}: ${a.errorKind}`).join('; ');
    super(`All Gemini routes failed — ${summary || 'no routes attempted'}`, { cause });
  }
}

export interface RouterOptions {
  routes: LlmRoute[];
  transport: RouteTransport;
  governor: Governor;
  breaker: CircuitBreaker;
  /** In-place retries for transient errors, per model. */
  transientRetries?: number;
  transientBackoffMs?: number;
  onEvent?: (event: { type: string; route: string; model?: string; detail?: string }) => void;
}

export function createRouter(opts: RouterOptions) {
  const transientRetries = opts.transientRetries ?? 3;
  const transientBackoffMs = opts.transientBackoffMs ?? 2000;

  // Between sweeps when every pool is busy: long enough not to spin, short enough that a freed
  // slot (flash calls run ~21s) is picked up promptly. Jittered so parked workers don't stampede.
  const SWEEP_SLEEP_MS = 750;
  const WAIT_LOG_EVERY_SWEEPS = 40; // ≈ every 30s of waiting

  async function call(req: GeminiRequest): Promise<GeminiCallResult> {
    const attempted: RouteAttempt[] = [];
    let lastErr: unknown;
    const waitingSince = Date.now();

    // Pools that returned a REAL non-rate-limit failure this call (refused / not_found /
    // transient-after-retries). Deterministic-ish failures must be attempted at most once per
    // call — re-sweeping a refusing image model bought a fresh billed generation every ~0.75s
    // while the call was parked behind a busy sibling. Rate-limited pools are deliberately NOT
    // in here: their pause governs them, and re-asking after an unpause is the whole point.
    const failedPools = new Set<string>();
    // A pool's repeat 429s while we wait carry no new information — record the first only.
    const rateLimitedRecorded = new Set<string>();
    const breakerSkipEmitted = new Set<string>();

    // Each sweep walks every route and model once, SKIPPING pools that are paused or have no free
    // slot instead of sleeping in their queue — a busy pool is a reason to try the next model, and
    // whichever pool frees first serves the call. Only when a full sweep finds nothing but busy
    // pools does the caller wait (briefly) and sweep again; a sweep that ends with real failures
    // and nothing left to wait for throws, exactly like the old single pass.
    for (let sweep = 0; ; sweep += 1) {
      // Routes/pools that may admit later: paused, saturated, 429'd this sweep, or behind an open
      // breaker (a cooldown, not a verdict — treating it as "nothing to wait for" terminally
      // failed every in-flight job during a 30s blip).
      let waitables = 0;

      for (const route of opts.routes) {
        if (!opts.breaker.canPass(route.id)) {
          waitables += 1;
          if (!breakerSkipEmitted.has(route.id)) {
            breakerSkipEmitted.add(route.id);
            opts.onEvent?.({ type: 'route_skipped_open_breaker', route: route.id });
          }
          continue;
        }

        // canPass may have consumed the breaker's single half-open probe. If this walk ends up
        // making no real attempt (every pool busy or already failed), that probe MUST be given
        // back — otherwise the breaker waits forever for a report that is never coming and the
        // route stays closed for the life of the process.
        let attemptsOnRoute = 0;

        for (const model of req.models) {
          // The capacity pool is route+model, not the route: throttling or pausing a whole route
          // because one model on it is saturated queues calls behind a limit the healthy models
          // never earned (measured: pro 429ing dragged flash from 21s to 108s of mostly queue wait).
          const pool = `${route.id}::${model}`;
          if (failedPools.has(pool)) continue; // hard-failed earlier in this call — done with it

          const start = Date.now();
          try {
            const outcome = await opts.governor.tryAcquire(pool, () =>
              withRetry(async () => {
                const resp = await opts.transport(route, model, req);
                if (req.expectImage && !resp.parts.some((p) => p.inlineData)) {
                  throw new ModelRefusedError(resp.finishReason ?? 'unknown');
                }
                return resp;
              }, {
                retries: transientRetries,
                backoffMs: transientBackoffMs,
                maxBackoffMs: 30_000,
                // In-place retries are for cheap transient blips (a 503 returns in ~1s). Two
                // exclusions: a refusal is deterministic-ish for the same model+input, and a
                // TIMEOUT-shaped error (client 499 / server 504) already burned up to the full
                // transport timeout proving the model is slow right now — repeating it holds this
                // pool's slot for up to 240s a round when a sibling serves in ~21s. All of these
                // still walk the chain below; they just don't repeat in place.
                shouldRetry: (err) => {
                  if (err instanceof ModelRefusedError) return false;
                  if (classifyError(err) !== 'transient') return false;
                  const status = errorHttpStatus(err);
                  return status !== 499 && status !== 504;
                },
                onRetry: (err, attempt, delayMs) =>
                  opts.onEvent?.({
                    type: 'transient_retry',
                    route: route.id,
                    model,
                    detail: `attempt ${attempt}, ${delayMs}ms: ${(err as Error).message}`,
                  }),
              }),
            );

            if (!outcome.acquired) {
              // No attempt was made and nothing was spent — the pool just has no room right now.
              // Not recorded in `attempted` (sweeps would flood it); it only marks this sweep as
              // having something worth waiting for.
              waitables += 1;
              continue;
            }

            opts.breaker.reportSuccess(route.id);
            return { response: outcome.value, routeUsed: route.id, modelUsed: model, attempted };
          } catch (err) {
            attemptsOnRoute += 1;
            lastErr = err;
            const kind = err instanceof ModelRefusedError ? ('refused' as const) : classifyError(err);

            if (kind !== 'rate_limited' || !rateLimitedRecorded.has(pool)) {
              if (kind === 'rate_limited') rateLimitedRecorded.add(pool);
              attempted.push({
                route: route.id,
                model,
                errorKind: kind,
                ms: Date.now() - start,
                message: (err as Error).message?.slice(0, 300) ?? String(err),
              });
            }

            if (kind === 'fatal_input') throw err;

            if (kind === 'rate_limited') {
              const delayMs = extractRetryDelayMs(err);
              opts.governor.reportRateLimit(pool, delayMs);
              // The pause suppresses re-asking; once it lapses this pool is worth another try.
              // NOTE: rate limits no longer open the route breaker. The per-pool pause already
              // does that job at the right scope — opening the route also blocked the OTHER model
              // family (text vs image) sharing it, and the all-models-in-one-sweep condition
              // could never fire once pauses staggered (each sweep saw at most one unpaused pool).
              waitables += 1;
              opts.onEvent?.({ type: 'rate_limited', route: route.id, model, detail: `pause ${delayMs ?? 15_000}ms` });
              continue;
            }

            // A real, non-429 failure: this pool is done for THIS call — later sweeps skip it.
            failedPools.add(pool);

            // Exhausted transient retries count against the route's health; a refusal or a
            // missing model id do not — the route itself is fine.
            if (kind === 'transient') opts.breaker.reportFailure(route.id);

            opts.onEvent?.({ type: kind, route: route.id, model, detail: (err as Error).message?.slice(0, 200) });
          }
        }

        if (attemptsOnRoute === 0) opts.breaker.refundProbe(route.id);
      }

      // Hard outcome: a full sweep made/observed only real failures with nothing left to come
      // back to. This is the old exhausted-walk case.
      if (waitables === 0) break;

      if (sweep > 0 && sweep % WAIT_LOG_EVERY_SWEEPS === 0) {
        opts.onEvent?.({
          type: 'waiting_for_capacity',
          route: 'all',
          detail: `${Math.round((Date.now() - waitingSince) / 1000)}s waiting, ${waitables} pools/routes busy`,
        });
      }

      // Everything with capacity worth having is momentarily full or paused. Wait briefly and
      // sweep again — whichever pool frees or unpauses first gets the call. Unbounded on purpose:
      // the blocking version waited indefinitely too, and the pg-boss step timeout is the backstop.
      await new Promise((r) => setTimeout(r, SWEEP_SLEEP_MS / 2 + Math.random() * SWEEP_SLEEP_MS));
    }

    throw new AllRoutesFailedError(attempted, lastErr);
  }

  return { call };
}

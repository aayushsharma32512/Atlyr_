import { describe, expect, test } from 'bun:test';
import { Governor } from '../../utils/governor';
import { CircuitBreaker } from '../../utils/circuit-breaker';
import { parseRoutes, type LlmRoute } from './route-spec';
import { createRouter, AllRoutesFailedError, type GeminiResponse, type RouteTransport } from './router';

const OK: GeminiResponse = { parts: [{ text: 'OK' }] };

function errWith(status: number, message: string): Error {
  const e = new Error(message) as Error & { status?: number };
  e.status = status;
  return e;
}

const ROUTES: LlmRoute[] = [
  { id: 'ai_studio', kind: 'ai_studio' },
  { id: 'vertex:global', kind: 'vertex', location: 'global' },
];

function makeRouter(transport: RouteTransport, routes: LlmRoute[] = ROUTES) {
  return createRouter({
    routes,
    transport,
    governor: new Governor(),
    breaker: new CircuitBreaker(5, 10_000),
    transientRetries: 1, // keep tests fast: no in-place retries unless a test wants them
    transientBackoffMs: 1,
  });
}

describe('parseRoutes', () => {
  test('parses the priority list', () => {
    expect(parseRoutes('ai_studio,vertex:global,vertex:us-central1')).toEqual([
      { id: 'ai_studio', kind: 'ai_studio' },
      { id: 'vertex:global', kind: 'vertex', location: 'global' },
      { id: 'vertex:us-central1', kind: 'vertex', location: 'us-central1' },
    ]);
  });

  test('dedupes and ignores blanks', () => {
    expect(parseRoutes('ai_studio, ai_studio,,')).toHaveLength(1);
  });

  test('rejects unknown tokens and empty specs', () => {
    expect(() => parseRoutes('openrouter')).toThrow(/unrecognised route/);
    expect(() => parseRoutes('')).toThrow(/no routes/);
  });
});

describe('createRouter', () => {
  test('first healthy route serves the call', async () => {
    const calls: string[] = [];
    const router = makeRouter(async (route, model) => { calls.push(`${route.id}/${model}`); return OK; });

    const res = await router.call({ models: ['m1', 'm2'], parts: [{ text: 'hi' }] });
    expect(res.routeUsed).toBe('ai_studio');
    expect(res.modelUsed).toBe('m1');
    expect(res.attempted).toHaveLength(0);
    expect(calls).toEqual(['ai_studio/m1']);
  });

  test('429 on one model still tries the other models on that route', async () => {
    // Vertex serves the image models through Dynamic Shared Quota, so an exhausted pool for one
    // model says nothing about its siblings — measured in production: gemini-3-pro-image 429s
    // while gemini-3.1-flash-image serves in 13s. Jumping straight to the next route threw that
    // capacity away and landed on a slower, flakier endpoint.
    const calls: string[] = [];
    const router = makeRouter(async (route, model) => {
      calls.push(`${route.id}/${model}`);
      if (model === 'm1') throw errWith(429, 'Resource exhausted. "retryDelay": "1s"');
      return OK;
    });

    const res = await router.call({ models: ['m1', 'm2'], parts: [] });
    expect(res.routeUsed).toBe('ai_studio');
    expect(res.modelUsed).toBe('m2');
    expect(calls).toEqual(['ai_studio/m1', 'ai_studio/m2']); // never left the first route
  });

  test('429 on EVERY model falls through to the next route WITHOUT opening the breaker', async () => {
    // Rate limits pause the pool, never the route: the route is shared with the text-model family,
    // whose pools may be idle. (Opening it also created a wedge — the all-models-in-one-sweep
    // condition could never re-fire once pauses staggered.)
    const breaker = new CircuitBreaker(5, 10_000);
    const calls: string[] = [];
    const router = createRouter({
      routes: ROUTES,
      transport: async (route, model) => {
        calls.push(`${route.id}/${model}`);
        if (route.id === 'ai_studio') throw errWith(429, 'Resource exhausted. "retryDelay": "1s"');
        return OK;
      },
      governor: new Governor(),
      breaker,
      transientRetries: 1,
      transientBackoffMs: 1,
    });

    const res = await router.call({ models: ['m1', 'm2'], parts: [] });
    expect(res.routeUsed).toBe('vertex:global');
    expect(calls).toEqual(['ai_studio/m1', 'ai_studio/m2', 'vertex:global/m1']);
    expect(breaker.isOpen('ai_studio')).toBe(false);
    expect(breaker.isOpen('vertex:global')).toBe(false);
  });

  test('a refusing model is attempted ONCE per call, even while the call is parked', async () => {
    // Re-sweeping a deterministically refusing image model bought a fresh BILLED generation every
    // ~0.75s while the call waited on a busy sibling pool.
    const governor = new Governor();
    governor.setLimit('ai_studio::mBusy', 1);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let refusals = 0;
    let holderRunning = false;
    const REFUSED: GeminiResponse = { parts: [{ text: 'no' }], finishReason: 'IMAGE_SAFETY' };
    const IMAGE: GeminiResponse = { parts: [{ inlineData: { mimeType: 'image/png', data: 'abc' } }] };
    const router = createRouter({
      routes: [ROUTES[0]],
      transport: async (_route, model) => {
        if (model === 'mBusy') {
          if (!holderRunning) { holderRunning = true; await gate; }
          return IMAGE; // expectImage is set — must actually contain one
        }
        refusals += 1;
        return REFUSED; // expectImage turns this into a refusal
      },
      governor,
      breaker: new CircuitBreaker(5, 10_000),
      transientRetries: 3, // must not matter: refusals never retry in place
      transientBackoffMs: 1,
    });

    const p1 = router.call({ models: ['mBusy'], parts: [], expectImage: true }); // occupies mBusy
    await new Promise((r) => setTimeout(r, 50));
    const p2 = router.call({ models: ['mRefuse', 'mBusy'], parts: [], expectImage: true });
    await new Promise((r) => setTimeout(r, 2_500)); // several sweeps pass while parked
    release();

    const [, r2] = await Promise.all([p1, p2]);
    expect(r2.modelUsed).toBe('mBusy');
    expect(refusals).toBe(1); // parked sweeps must not re-buy the refusal
    expect(r2.attempted.filter((a) => a.model === 'mRefuse')).toHaveLength(1);
  }, 20_000);

  test('a timeout-shaped error (499/504) is not retried in place — the chain walks instead', async () => {
    // Each in-place retry of a timeout re-holds the slot for up to the full transport timeout;
    // the model just proved it is slow NOW, and a sibling serves in ~21s.
    const calls: string[] = [];
    const router = createRouter({
      routes: [ROUTES[0]],
      transport: async (_route, model) => {
        calls.push(model);
        if (model === 'm1') throw errWith(504, '{"error":{"code":504,"status":"DEADLINE_EXCEEDED"}}');
        return OK;
      },
      governor: new Governor(),
      breaker: new CircuitBreaker(5, 10_000),
      transientRetries: 3,
      transientBackoffMs: 1,
    });

    const res = await router.call({ models: ['m1', 'm2'], parts: [] });
    expect(res.modelUsed).toBe('m2');
    expect(calls).toEqual(['m1', 'm2']); // exactly one m1 attempt — no in-place retries
  });

  test('an open breaker parks the call instead of failing it terminally', async () => {
    // A 30s breaker cooldown is a blip. Throwing AllRoutesFailedError here marked the pipeline
    // job failed (terminal) — every in-flight job died for a transient condition.
    const breaker = new CircuitBreaker(1, 300);
    breaker.reportFailure('ai_studio'); // open now, cools down in 300ms
    const router = createRouter({
      routes: [ROUTES[0]],
      transport: async () => OK,
      governor: new Governor(),
      breaker,
      transientRetries: 1,
      transientBackoffMs: 1,
    });

    const res = await router.call({ models: ['m1'], parts: [] }); // must not throw
    expect(res.routeUsed).toBe('ai_studio');
  }, 15_000);

  test('a burned half-open probe cannot wedge the route closed forever', async () => {
    // The pure wedge: breaker open, cooldown lapses, a sweep consumes the half-open probe but
    // makes ZERO attempts because the pool is paused — and since nothing is in flight anywhere on
    // the route, no reportSuccess/reportFailure is ever coming. halfOpen stayed true and the route
    // was dead for the life of the process. The walk must refund the probe (and the breaker
    // re-arms on a timer besides) so the call completes once the pause lapses.
    const breaker = new CircuitBreaker(1, 100);
    breaker.reportFailure('ai_studio'); // open; half-open probe available after 100ms
    const governor = new Governor();
    // Paused for several sweep periods (sweeps are ~375-1125ms apart), so multiple probe-consuming
    // zero-attempt sweeps are guaranteed before the pause lapses. Nobody holds the pool: no report
    // is ever coming from anywhere else.
    governor.reportRateLimit('ai_studio::m1', 3_000);
    const router = createRouter({
      routes: [ROUTES[0]],
      transport: async () => OK,
      governor,
      breaker,
      transientRetries: 1,
      transientBackoffMs: 1,
    });

    // Sweeps between t=100ms (cooldown lapse) and t=900ms (pause lapse) each take the probe and
    // make zero attempts. Without refund/re-arm the route never reopens and this call never ends.
    const res = await router.call({ models: ['m1'], parts: [] });
    expect(res.routeUsed).toBe('ai_studio');
  }, 20_000);

  test('a paused pool is skipped immediately, not slept out', async () => {
    // The 43-minute batch: acquire() slept out the primary model's pause + slot queue, so every
    // call serialized behind gemini-3-pro-image while flash sat idle (21s calls measured at up to
    // 1400s). A paused pool must mean "next model, now".
    const governor = new Governor();
    governor.reportRateLimit('ai_studio::m1', 60_000);
    const calls: string[] = [];
    const router = createRouter({
      routes: ROUTES,
      transport: async (route, model) => { calls.push(`${route.id}/${model}`); return OK; },
      governor,
      breaker: new CircuitBreaker(5, 10_000),
      transientRetries: 1,
      transientBackoffMs: 1,
    });

    const t = Date.now();
    const res = await router.call({ models: ['m1', 'm2'], parts: [] });
    expect(res.modelUsed).toBe('m2');
    expect(res.routeUsed).toBe('ai_studio');
    expect(calls).toEqual(['ai_studio/m2']); // m1 never attempted — and never waited for
    expect(Date.now() - t).toBeLessThan(2_000);
  });

  test('when every pool is momentarily full the call waits and takes the first freed slot', async () => {
    const governor = new Governor();
    governor.setLimit('ai_studio::m1', 1);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let first = true;
    const router = createRouter({
      routes: [ROUTES[0]], // one route so the second call has nowhere else to go
      transport: async () => {
        if (first) { first = false; await gate; }
        return OK;
      },
      governor,
      breaker: new CircuitBreaker(5, 10_000),
      transientRetries: 1,
      transientBackoffMs: 1,
    });

    const p1 = router.call({ models: ['m1'], parts: [] });
    await new Promise((r) => setTimeout(r, 50));       // p1 now holds the pool's only slot
    const p2 = router.call({ models: ['m1'], parts: [] }); // must sweep, not throw
    await new Promise((r) => setTimeout(r, 100));
    release();

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.routeUsed).toBe('ai_studio');
    expect(r2.routeUsed).toBe('ai_studio');
  }, 15_000);

  test('a 499 client-timeout walks the chain instead of failing the job', async () => {
    // httpOptions.timeout aborting a slow generation surfaces as 499 CANCELLED. It was classified
    // fatal_input, which throws without trying ANY other model — a transient condition killed the
    // job and skipped the entire fallback chain that exists for it.
    const calls: string[] = [];
    const router = makeRouter(async (route, model) => {
      calls.push(`${route.id}/${model}`);
      if (model === 'm1') throw errWith(499, '{"error":{"code":499,"message":"The operation was cancelled.","status":"CANCELLED"}}');
      return OK;
    });

    const res = await router.call({ models: ['m1', 'm2'], parts: [] });
    expect(res.modelUsed).toBe('m2');
    expect(res.attempted[0]).toEqual(
      expect.objectContaining({ route: 'ai_studio', model: 'm1', errorKind: 'transient' }),
    );
  });

  test('a route with one healthy model is NOT faulted by the breaker', async () => {
    const breaker = new CircuitBreaker(5, 10_000);
    const router = createRouter({
      routes: ROUTES,
      transport: async (_route, model) => {
        if (model === 'm1') throw errWith(429, 'Resource exhausted');
        return OK;
      },
      governor: new Governor(),
      breaker,
      transientRetries: 1,
      transientBackoffMs: 1,
    });

    await router.call({ models: ['m1', 'm2'], parts: [] });
    expect(breaker.isOpen('ai_studio')).toBe(false);
  });

  test('a 429 pauses the governor for that route+model only', async () => {
    const governor = new Governor();
    const router = createRouter({
      routes: ROUTES,
      transport: async (route) => {
        if (route.id === 'ai_studio') throw errWith(429, '"retryDelay": "60s"');
        return OK;
      },
      governor,
      breaker: new CircuitBreaker(5, 10_000),
      transientRetries: 1,
    });

    await router.call({ models: ['m1'], parts: [] });
    // Pause is model-scoped: the exhausted pool is m1's, so m2 on the same route stays usable.
    expect(governor.isPaused('ai_studio::m1')).toBe(true);
    expect(governor.isPaused('ai_studio::m2')).toBe(false);
    expect(governor.isPaused('ai_studio')).toBe(false);
    expect(governor.isPaused('vertex:global::m1')).toBe(false);
  });

  test('404 tries the next MODEL on the same route', async () => {
    const calls: string[] = [];
    const router = makeRouter(async (route, model) => {
      calls.push(`${route.id}/${model}`);
      if (model === 'm1') throw errWith(404, 'model not found');
      return OK;
    });

    const res = await router.call({ models: ['m1', 'm2'], parts: [] });
    expect(res.routeUsed).toBe('ai_studio');
    expect(res.modelUsed).toBe('m2');
    expect(calls).toEqual(['ai_studio/m1', 'ai_studio/m2']);
  });

  test('fatal_input throws immediately — no fallback masks a bad request', async () => {
    let calls = 0;
    const router = makeRouter(async () => { calls += 1; throw errWith(400, 'Invalid argument'); });

    await expect(router.call({ models: ['m1', 'm2'], parts: [] })).rejects.toThrow('Invalid argument');
    expect(calls).toBe(1);
  });

  test('transient errors retry in place before falling through', async () => {
    let attempts = 0;
    const router = createRouter({
      routes: ROUTES,
      transport: async () => {
        attempts += 1;
        if (attempts < 3) throw errWith(503, 'overloaded');
        return OK;
      },
      governor: new Governor(),
      breaker: new CircuitBreaker(5, 10_000),
      transientRetries: 3,
      transientBackoffMs: 1,
    });

    const res = await router.call({ models: ['m1'], parts: [] });
    expect(res.routeUsed).toBe('ai_studio');
    expect(attempts).toBe(3);
  });

  test('open breaker skips the route entirely', async () => {
    const breaker = new CircuitBreaker(1, 60_000);
    breaker.reportFailure('ai_studio'); // open it
    const calls: string[] = [];
    const router = createRouter({
      routes: ROUTES,
      transport: async (route) => { calls.push(route.id); return OK; },
      governor: new Governor(),
      breaker,
      transientRetries: 1,
    });

    const res = await router.call({ models: ['m1'], parts: [] });
    expect(res.routeUsed).toBe('vertex:global');
    expect(calls).toEqual(['vertex:global']);
  });

  test('imageless 200 with expectImage walks models then routes (the IMAGE_SAFETY case)', async () => {
    const calls: string[] = [];
    const REFUSED: GeminiResponse = { parts: [{ text: 'blocked' }], finishReason: 'IMAGE_SAFETY' };
    const IMAGE: GeminiResponse = { parts: [{ inlineData: { mimeType: 'image/png', data: 'abc' } }] };
    const router = makeRouter(async (route, model) => {
      calls.push(`${route.id}/${model}`);
      // ai_studio refuses on every model; vertex serves the image on its first model.
      return route.id === 'ai_studio' ? REFUSED : IMAGE;
    });

    const res = await router.call({ models: ['m1', 'm2'], parts: [], expectImage: true });
    expect(res.routeUsed).toBe('vertex:global');
    expect(calls).toEqual(['ai_studio/m1', 'ai_studio/m2', 'vertex:global/m1']);
    expect(res.attempted.map((a) => a.errorKind)).toEqual(['refused', 'refused']);
  });

  test('refusals are not retried in place and do not trip the breaker', async () => {
    let calls = 0;
    const breaker = new CircuitBreaker(1, 60_000); // threshold 1: any breaker-counted failure opens it
    const router = createRouter({
      routes: [ROUTES[0]],
      transport: async () => { calls += 1; return { parts: [], finishReason: 'IMAGE_SAFETY' }; },
      governor: new Governor(),
      breaker,
      transientRetries: 3, // would retry 3× if a refusal were misclassified as transient
      transientBackoffMs: 1,
    });

    await expect(router.call({ models: ['m1'], parts: [], expectImage: true })).rejects.toThrow(/refused/);
    expect(calls).toBe(1);                       // no in-place retries
    expect(breaker.isOpen('ai_studio')).toBe(false); // route health untouched
  });

  test('without expectImage, an imageless 200 passes through as success', async () => {
    const router = makeRouter(async () => ({ parts: [{ text: 'just text' }] }));
    const res = await router.call({ models: ['m1'], parts: [] });
    expect(res.response.parts[0].text).toBe('just text');
  });

  test('every route failing raises AllRoutesFailedError with the attempt log', async () => {
    const router = makeRouter(async () => { throw errWith(503, 'down'); });

    try {
      await router.call({ models: ['m1'], parts: [] });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AllRoutesFailedError);
      const attempts = (err as AllRoutesFailedError).attempted;
      expect(attempts.map((a) => a.route)).toEqual(['ai_studio', 'vertex:global']);
      expect(attempts.every((a) => a.errorKind === 'transient')).toBe(true);
    }
  });
});

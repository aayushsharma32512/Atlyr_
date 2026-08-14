import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import type PgBoss from 'pg-boss';
import type { BossHandle } from './boss';

// config/index.ts validates env at import time and process.exit(1)s when it is absent, so the
// environment has to exist before boss.ts (which imports config) is evaluated — hence the dynamic
// import below rather than a static one. The backoff is squashed so restarts don't sleep seconds.
process.env.SUPABASE_URL ??= 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-key';
process.env.DATABASE_URL_DIRECT ??= 'postgres://localhost:5432/test';
process.env.API_TOKEN ??= 'test-token';
process.env.BOSS_RESTART_BASE_MS = '1';
process.env.BOSS_RESTART_MAX_MS = '4';

const { initBoss } = await import('./boss');

// config is a module singleton parsed once per process, so if another test file imported it first
// the env overrides above were already too late. Size the waits off whatever config actually holds
// instead of assuming they took effect — otherwise this file passes or fails on test ordering.
const { config } = await import('../config/index');
const RESTART_BUDGET_MS = Math.max(2_000, config.BOSS_RESTART_BASE_MS * 4);

const silent = { info: () => {}, warn: () => {}, error: () => {} };

class FakeBoss extends EventEmitter {
  starts = 0;
  stops = 0;
  sent: string[] = [];
  worked: string[] = [];

  async start() {
    this.starts += 1;
    return this;
  }
  async stop() {
    this.stops += 1;
  }
  async send(name: string) {
    this.sent.push(name);
    return 'job-1';
  }
  async work(name: string) {
    this.worked.push(name);
    return 'worker-1';
  }
}

function harness() {
  const instances: FakeBoss[] = [];
  const createBoss = () => {
    const instance = new FakeBoss();
    instances.push(instance);
    return instance as unknown as PgBoss;
  };
  return { instances, createBoss };
}

async function waitFor(predicate: () => boolean, timeoutMs = RESTART_BUDGET_MS) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 2));
  }
}

const boom = () => new Error("Cannot destructure property 'secondsAgo' from null or undefined value");

describe('initBoss restart', () => {
  test('replaces the instance rather than restarting the stopped one', async () => {
    const { instances, createBoss } = harness();
    await initBoss(silent, { createBoss });
    expect(instances).toHaveLength(1);

    instances[0].emit('error', boom());
    await waitFor(() => instances.length === 2);

    // A pg-boss v9 instance never recovers from stop(), so reusing it is what produced the
    // every-4-minutes error storm. The old one is stopped exactly once and left behind.
    expect(instances[0].stops).toBe(1);
    expect(instances[1].starts).toBe(1);
    expect(instances[1].stops).toBe(0);
  });

  test('the handle follows the live instance across a restart', async () => {
    const { instances, createBoss } = harness();
    const boss: BossHandle = await initBoss(silent, { createBoss });

    await boss.send('before-restart', {}, {});
    instances[0].emit('error', boom());
    await waitFor(() => instances.length === 2);
    await boss.send('after-restart', {}, {});

    // Callers capture the handle at boot; if it still pointed at the retired instance the enqueue
    // would resolve and the job would never run.
    expect(instances[0].sent).toEqual(['before-restart']);
    expect(instances[1].sent).toEqual(['after-restart']);
  });

  test('re-registers workers on the new instance', async () => {
    const { instances, createBoss } = harness();
    const reasons: string[] = [];
    await initBoss(silent, {
      createBoss,
      registerWorkers: async (boss, ctx) => {
        reasons.push(ctx.reason);
        await boss.work('run-pipeline-step', {}, async () => {});
      },
    });

    instances[0].emit('error', boom());
    await waitFor(() => instances.length === 2 && instances[1].worked.length === 1);

    expect(reasons).toEqual(['start', 'restart']);
    expect(instances[1].worked).toEqual(['run-pipeline-step']);
  });

  test('a retired instance cannot trigger another restart', async () => {
    const { instances, createBoss } = harness();
    await initBoss(silent, { createBoss });

    instances[0].emit('error', boom());
    await waitFor(() => instances.length === 2);

    // The old loop: a stopped instance kept firing its leaked maintenance timer, and every tick
    // restarted the service again and leaked one more timer. Retired instances are now inert.
    instances[0].emit('error', boom());
    instances[0].emit('error', boom());
    // Long enough that a restart triggered by those emissions would have produced instance #3.
    await new Promise((r) => setTimeout(r, RESTART_BUDGET_MS));

    expect(instances).toHaveLength(2);
    // Waits twice on the restart budget, which can exceed bun's 5s default when the backoff is
    // whatever .env configured rather than the 1ms this file asked for.
  }, RESTART_BUDGET_MS * 4);
});

import PgBoss from 'pg-boss';
import { config } from '../config/index';
import { createLogger } from '../utils/logger';

type RegisterWorkersContext = { generation: number; reason: 'start' | 'restart' };
type InitBossOptions = {
  registerWorkers?: (boss: BossHandle, ctx: RegisterWorkersContext) => Promise<void> | void;
  /** Instance factory. Overridden in tests so the restart path can run without a database. */
  createBoss?: () => PgBoss;
};

// What callers hold instead of the PgBoss instance itself. A restart swaps the instance underneath
// (see below), so anything that captured the raw object at boot — the route closures, the
// advance-and-trigger singleton — would keep enqueueing onto a stopped one and silently drop work.
// The handle always forwards to whichever instance is live.
export type BossHandle = {
  send(name: string, data: object, options: PgBoss.SendOptions): Promise<string | null>;
  work<ReqData>(
    name: string,
    options: PgBoss.WorkOptions,
    handler: PgBoss.WorkHandler<ReqData>,
  ): Promise<string>;
  /** Used by boot recovery to retire queue rows a dead process left behind. */
  cancel(ids: string[]): Promise<void>;
  /**
   * Cron registration. Forwarded like the rest because the schedule is persisted in the DB but the
   * WORKER for it is not: a restart that re-registers workers must re-attach through the live
   * instance, or the schedule keeps emitting ticks nobody consumes.
   */
  schedule(
    name: string,
    cron: string,
    data?: object,
    options?: PgBoss.ScheduleOptions,
  ): Promise<void>;
};

function parseExpireAfter(input: string): number {
  if (input.startsWith('PT') && input.endsWith('H')) return Number(input.slice(2, -1)) * 3600;
  if (input.startsWith('P') && input.endsWith('D')) return Number(input.slice(1, -1)) * 86400;
  return 7200;
}

export async function initBoss(
  logger = createLogger({ stage: 'boss' }),
  options: InitBossOptions = {},
): Promise<BossHandle> {
  const { registerWorkers } = options;

  const construct =
    options.createBoss ??
    (() =>
      new PgBoss({
        connectionString: config.DATABASE_URL_DIRECT,
        schema: config.BOSS_SCHEMA,
        // Retention for COMPLETED rows, not a step timeout. The per-step limit is set at send time
        // via expireInSeconds (see queue/send-step.ts) — BOSS_EXPIRE_AFTER has never governed it.
        archiveCompletedAfterSeconds: parseExpireAfter(config.BOSS_EXPIRE_AFTER),
      }));

  const restartState = {
    attempts: 0,
    restarting: false,
    cooldownTimer: null as ReturnType<typeof setTimeout> | null,
  };
  let generation = 0;

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const backoffMs = (attempt: number) => {
    const raw = config.BOSS_RESTART_BASE_MS * Math.pow(2, attempt);
    const jitter = Math.floor(raw * 0.2 * Math.random());
    return Math.min(config.BOSS_RESTART_MAX_MS, raw + jitter);
  };

  // A pg-boss v9 instance is single-use: stop() sets `stopped` on the internal Boss and start()
  // never clears it, so a restarted instance runs a maintenance timer whose every tick throws
  // (`Cannot destructure property 'secondsAgo'`) while expire/archive/purge silently no-op. Worse,
  // that thrown tick arrives as an 'error' event, which restarts us again and leaks one more timer
  // each time. So a restart builds a NEW instance and retires the old one.
  const createInstance = (): PgBoss => {
    const instance = construct();

    // Left attached even after retirement: PgBoss is an EventEmitter, and an 'error' emitted with
    // no listener would take the process down. A retired instance only gets to log.
    instance.on('error', (err) => {
      if (instance !== current) {
        logger.warn({ error: err.message, generation }, 'pg-boss error from retired instance');
        return;
      }
      logger.error({ error: err.message }, 'pg-boss error');
      void restartBoss(err);
    });

    return instance;
  };

  let current = createInstance();

  const handle: BossHandle = {
    send: (name, data, opts) => current.send(name, data, opts),
    work: (name, opts, handler) => current.work(name, opts, handler),
    cancel: (ids) => current.cancel(ids),
    schedule: (name, cron, data, opts) => current.schedule(name, cron, data, opts),
  };

  const startAndRegister = async (reason: 'start' | 'restart') => {
    await current.start();
    generation += 1;
    logger.info({ schema: config.BOSS_SCHEMA, generation }, `pg-boss ${reason}`);
    // Workers are registered through the handle, which already points at the new instance —
    // subscriptions live on the instance, so they have to be re-established every restart.
    if (registerWorkers) await registerWorkers(handle, { generation, reason });
  };

  const restartBoss = async (cause?: Error) => {
    if (restartState.restarting) return;
    restartState.restarting = true;

    while (restartState.attempts < config.BOSS_RESTART_MAX_ATTEMPTS) {
      await sleep(backoffMs(restartState.attempts));
      try {
        const retired = current;
        await retired.stop({ destroy: true, graceful: false, timeout: 10_000 }).catch(() => {});
        current = createInstance();
        await startAndRegister('restart');
        restartState.attempts = 0;
        restartState.restarting = false;
        return;
      } catch (err) {
        restartState.attempts += 1;
        logger.error({ error: (err as Error).message }, 'pg-boss restart attempt failed');
      }
    }

    logger.error({ cause: cause?.message }, 'pg-boss restart exhausted');
    restartState.attempts = 0;
    restartState.restarting = false;
    if (!restartState.cooldownTimer) {
      restartState.cooldownTimer = setTimeout(() => {
        restartState.cooldownTimer = null;
        void restartBoss(cause);
      }, config.BOSS_RESTART_MAX_MS);
    }
  };

  await startAndRegister('start');
  return handle;
}

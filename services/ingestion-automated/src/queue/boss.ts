import PgBoss from 'pg-boss';
import { config } from '../config/index';
import { createLogger } from '../utils/logger';

type RegisterWorkersContext = { generation: number; reason: 'start' | 'restart' };
type InitBossOptions = {
  registerWorkers?: (boss: PgBoss, ctx: RegisterWorkersContext) => Promise<void> | void;
};

function parseExpireAfter(input: string): number {
  if (input.startsWith('PT') && input.endsWith('H')) return Number(input.slice(2, -1)) * 3600;
  if (input.startsWith('P') && input.endsWith('D')) return Number(input.slice(1, -1)) * 86400;
  return 7200;
}

export async function initBoss(
  logger = createLogger({ stage: 'boss' }),
  options: InitBossOptions = {}
): Promise<PgBoss> {
  const { registerWorkers } = options;

  const boss = new PgBoss({
    connectionString: config.DATABASE_URL_DIRECT,
    schema: config.BOSS_SCHEMA,
    archiveCompletedAfterSeconds: parseExpireAfter(config.BOSS_EXPIRE_AFTER),
  });

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

  const startAndRegister = async (reason: 'start' | 'restart') => {
    await boss.start();
    generation += 1;
    logger.info({ schema: config.BOSS_SCHEMA, generation }, `pg-boss ${reason}`);
    if (registerWorkers) await registerWorkers(boss, { generation, reason });
  };

  const restartBoss = async (cause?: Error) => {
    if (restartState.restarting) return;
    restartState.restarting = true;

    while (restartState.attempts < config.BOSS_RESTART_MAX_ATTEMPTS) {
      await sleep(backoffMs(restartState.attempts));
      try {
        await boss.stop({ destroy: true, graceful: false, timeout: 10_000 }).catch(() => {});
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

  boss.on('error', (err) => {
    logger.error({ error: err.message }, 'pg-boss error');
    void restartBoss(err);
  });

  await startAndRegister('start');
  return boss;
}

import PgBoss, { type Job } from 'pg-boss';
import { config } from '../config/index';
import { createLogger } from '../utils/logger';

type RegisterWorkersContext = {
  generation: number;
  reason: 'start' | 'restart';
};

type InitBossOptions = {
  registerWorkers?: (boss: PgBoss, context: RegisterWorkersContext) => Promise<void> | void;
};

export async function initBoss(
  logger = createLogger({ stage: 'boss' }),
  options: InitBossOptions = {}
) {
  const { registerWorkers } = options;
  const boss = new PgBoss({
    connectionString: config.DATABASE_URL_DIRECT,
    schema: config.BOSS_SCHEMA,
    archiveCompletedAfterSeconds: parseISODurationToSeconds(config.BOSS_ARCHIVE_AFTER)
  });
  const restartState = {
    attempts: 0,
    restarting: false,
    cooldownTimer: null as ReturnType<typeof setTimeout> | null
  };
  let generation = 0;

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const computeBackoffMs = (attempt: number) => {
    const base = Math.max(0, config.BOSS_RESTART_BASE_MS);
    const max = Math.max(base, config.BOSS_RESTART_MAX_MS);
    const raw = base * Math.pow(2, attempt);
    const jitter = Math.floor(raw * 0.2 * Math.random());
    return Math.min(max, raw + jitter);
  };

  const stopForRestart = async () => {
    try {
      await boss.stop({ destroy: true, graceful: false, timeout: 10_000 });
    } catch (error) {
      logger.warn({ error: (error as Error)?.message }, 'pg-boss stop failed (continuing restart)');
    }
  };

  const startAndRegister = async (reason: 'start' | 'restart') => {
    await boss.start();
    generation += 1;
    logger.info({ schema: config.BOSS_SCHEMA, generation }, reason === 'start' ? 'pg-boss started' : 'pg-boss restarted');
    if (registerWorkers) {
      try {
        await registerWorkers(boss, { generation, reason });
        logger.info({ generation }, 'pg-boss workers registered');
      } catch (error) {
        logger.error({ error: (error as Error)?.message, generation }, 'pg-boss worker registration failed');
        throw error;
      }
    }
  };

  const restartBoss = async (cause?: Error) => {
    if (restartState.restarting) return;
    restartState.restarting = true;

    const maxAttempts = Math.max(1, config.BOSS_RESTART_MAX_ATTEMPTS);
    while (restartState.attempts < maxAttempts) {
      const delayMs = computeBackoffMs(restartState.attempts);
      logger.warn({ delayMs, attempt: restartState.attempts + 1, cause: cause?.message }, 'pg-boss restart scheduled');
      await sleep(delayMs);
      await stopForRestart();

      try {
        await startAndRegister('restart');
        restartState.attempts = 0;
        restartState.restarting = false;
        return;
      } catch (error) {
        restartState.attempts += 1;
        logger.error({ error: (error as Error)?.message }, 'pg-boss restart attempt failed');
      }
    }

    logger.error({ attempts: restartState.attempts }, 'pg-boss restart exhausted');
    restartState.attempts = 0;
    restartState.restarting = false;
    if (!restartState.cooldownTimer) {
      const cooldownMs = Math.max(15_000, config.BOSS_RESTART_MAX_MS);
      logger.warn({ delayMs: cooldownMs }, 'pg-boss restart cooldown scheduled');
      restartState.cooldownTimer = setTimeout(() => {
        restartState.cooldownTimer = null;
        void restartBoss(cause);
      }, cooldownMs);
    }
  };

  boss.on('error', (error) => {
    logger.error({ error: error.message }, 'pg-boss error');
    void restartBoss(error);
  });
  await startAndRegister('start');
  return boss;
}

export async function withTestSubscriber(boss: PgBoss, logger = createLogger({ stage: 'boss' })) {
  await boss.work('ingestion-test', async (job: Job<unknown>) => {
    if (job?.id) {
      logger.info({ jobId: job.id }, 'Received test job');
    } else {
      logger.info({}, 'Received test job without id');
    }
  });
}

function parseISODurationToSeconds(input: string): number {
  // Very small parser for PTxxH / PxxD patterns we use
  if (input.startsWith('PT') && input.endsWith('H')) {
    const hours = Number(input.slice(2, -1));
    return Math.max(0, Math.floor(hours * 3600));
  }
  if (input.startsWith('P') && input.endsWith('D')) {
    const days = Number(input.slice(1, -1));
    return Math.max(0, Math.floor(days * 86400));
  }
  return 0;
}

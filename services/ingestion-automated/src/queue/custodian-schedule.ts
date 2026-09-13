/**
 * Cron registration for the custodian.
 *
 * Registered from inside `registerWorkers`, not once from index.ts, for the same reason the batch
 * schedules are: `boss.schedule` is an idempotent upsert so calling it per generation is free,
 * whereas wiring it once at startup means that after a pg-boss restart the DB-persisted schedule
 * keeps emitting ticks with nobody working the queue — and the pass goes quiet without one error
 * line to show for it.
 *
 * `singletonKey` is what makes this safe to run at all: both rescue passes document a
 * single-instance assumption, and it stops two ticks (or two service instances) from reaping the
 * same rows concurrently.
 */
import type { BossHandle } from './boss';
import { config } from '../config/index';
import { runCustodian } from '../orchestration/custodian';
import { createLogger } from '../utils/logger';

const logger = createLogger({ stage: 'custodian-schedule' });

const CUSTODIAN_QUEUE = 'pipeline-custodian';

export function registerCustodianSchedule(boss: BossHandle): void {
  boss.work(CUSTODIAN_QUEUE, {}, async () => {
    try {
      const result = await runCustodian(boss);
      // Every pass belongs in this condition. `failuresRetried` was missing, so a tick whose ONLY
      // work was retrying failures logged nothing at all — the pass looked dead from the outside
      // while it was running, which is exactly the silence that hid the retry-budget bug.
      if (result.resumed || result.modalTimedOut || result.reaped
          || result.clearedQueueRows || result.failuresRetried) {
        logger.info({ ...result }, 'custodian tick');
      }
    } catch (err) {
      logger.error({ error: (err as Error).message }, 'custodian tick failed');
    }
  });

  void boss.schedule(CUSTODIAN_QUEUE, config.CUSTODIAN_CRON, {}, {
    singletonKey: CUSTODIAN_QUEUE,
    expireInSeconds: 600,
  });

  logger.info(
    { enabled: config.CUSTODIAN_ENABLED, cron: config.CUSTODIAN_CRON, reaperMode: config.REAPER_MODE, autoRetryFailed: config.AUTO_RETRY_FAILED, autoRetryBatchSize: config.AUTO_RETRY_BATCH_SIZE },
    'custodian schedule registered',
  );
}

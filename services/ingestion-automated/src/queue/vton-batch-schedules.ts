/**
 * Cron registration for the economy lane's collector and poller.
 *
 * Registered from inside `registerWorkers`, alongside the pipeline worker, and NOT once from
 * index.ts. `boss.schedule` is an idempotent upsert, so calling it on every generation is free —
 * whereas wiring the handlers once at startup means that after a pg-boss restart the DB-persisted
 * schedule keeps emitting ticks with nobody working the queue, and the lane goes quiet without a
 * single error line.
 *
 * `singletonKey` keeps a slow tick from overlapping itself, and keeps two service instances from
 * running the same tick concurrently — the collector's claim is already safe under concurrency,
 * but there is no reason to pay for the contention.
 */
import type { BossHandle } from './boss';
import { config } from '../config/index';
import { collectVtonBatch } from '../orchestration/vton-batch-collector';
import { pollVtonBatches } from '../orchestration/vton-batch-poller';
import { createLogger } from '../utils/logger';

const logger = createLogger({ stage: 'vton-batch-schedules' });

const COLLECT_QUEUE = 'vton-batch-collect';
const POLL_QUEUE = 'vton-batch-poll';

export function registerVtonBatchSchedules(boss: BossHandle): void {
  boss.work(COLLECT_QUEUE, {}, async () => {
    try {
      const result = await collectVtonBatch(boss);
      if (result.submitted || result.demoted) {
        logger.info({ ...result }, 'collector tick');
      }
    } catch (err) {
      logger.error({ error: (err as Error).message }, 'collector tick failed');
    }
  });

  boss.work(POLL_QUEUE, {}, async () => {
    try {
      const result = await pollVtonBatches(boss);
      if (result.applied || result.demoted || result.released) {
        logger.info({ ...result }, 'poller tick');
      }
    } catch (err) {
      logger.error({ error: (err as Error).message }, 'poller tick failed');
    }
  });

  // The poller is scheduled unconditionally. Disabling the lane must stop new submissions, not
  // abandon trays already at Google — those jobs are parked and only the poller can free them.
  void boss.schedule(POLL_QUEUE, config.VTON_BATCH_POLL_CRON, {}, {
    singletonKey: POLL_QUEUE,
    expireInSeconds: 600,
  });

  void boss.schedule(COLLECT_QUEUE, config.VTON_BATCH_FLUSH_CRON, {}, {
    singletonKey: COLLECT_QUEUE,
    // Sized for ~30 garment fetches plus the submit call, comfortably inside the 5-minute cadence.
    expireInSeconds: 600,
  });

  logger.info(
    {
      enabled: config.VTON_BATCH_ENABLED,
      model: config.VTON_BATCH_MODEL,
      flushSize: config.VTON_BATCH_FLUSH_SIZE,
      flushCron: config.VTON_BATCH_FLUSH_CRON,
      pollCron: config.VTON_BATCH_POLL_CRON,
    },
    'vton batch schedules registered',
  );
}

/**
 * One collector + poller pass at boot, mirroring the reaper. A restart otherwise adds a whole
 * cron interval of latency to whatever was already parked or already finished at Google.
 */
export async function runVtonBatchBootPass(boss: BossHandle): Promise<void> {
  try {
    await pollVtonBatches(boss);
    await collectVtonBatch(boss);
  } catch (err) {
    // Never block startup on the lane.
    logger.error({ error: (err as Error).message }, 'boot pass failed');
  }
}

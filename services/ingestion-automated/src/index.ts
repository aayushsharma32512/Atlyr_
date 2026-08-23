import { config } from './config/index';
import { createLogger } from './utils/logger';
import { initBoss } from './queue/boss';
import { startWorker } from './queue/worker';
import { buildApp } from './api/index';
import { reapStrandedJobs } from './orchestration/reaper';
import { recoverOrphanedJobs } from './orchestration/boot-recovery';
import { runVtonBatchBootPass } from './queue/vton-batch-schedules';
import { ensureBucketExists } from './utils/ensure-bucket';

const logger = createLogger({ stage: 'bootstrap' });

async function main() {
  logger.info({}, 'starting ingestion-automated service');
  await ensureBucketExists();

  const boss = await initBoss(logger, {
    registerWorkers: async (bossInstance, ctx) => {
      // BEFORE the workers start consuming, and only on a genuine process start: recover the work
      // the previous process died holding. Ordering is load-bearing — once this process is
      // consuming, its own in-flight jobs are indistinguishable from a dead process's and would be
      // recovered out from under themselves. A pg-boss restart (ctx.reason === 'restart') is not a
      // process restart: those handlers are still running, so there is nothing to recover.
      if (ctx.reason === 'start') {
        await recoverOrphanedJobs(bossInstance);
      }
      startWorker(bossInstance);
    },
  });

  // Separate from the above: fail rows that have been idle far longer than a step may take. Those
  // are not "the process died a moment ago" — they are long-abandoned, and failing surfaces them
  // in the UI with the Restart-from-step path rather than silently re-running partial work.
  await reapStrandedJobs();

  // Catch up on anything the economy lane left mid-flight across the restart before the first
  // cron tick would have.
  await runVtonBatchBootPass(boss);

  const app = await buildApp(boss);

  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  logger.info({ port: config.PORT }, 'ingestion-automated service listening');
}

main().catch((err) => {
  console.error('Fatal startup error', err);
  process.exit(1);
});

import { config } from './config/index';
import { createLogger } from './utils/logger';
import { initBoss } from './queue/boss';
import { startWorker } from './queue/worker';
import { buildApp } from './api/index';
import { reapStrandedJobs } from './orchestration/reaper';
import { ensureBucketExists } from './utils/ensure-bucket';

const logger = createLogger({ stage: 'bootstrap' });

async function main() {
  logger.info({}, 'starting ingestion-automated service');
  await ensureBucketExists();

  const boss = await initBoss(logger, {
    registerWorkers: (bossInstance) => {
      startWorker(bossInstance);
    },
  });

  // Once at boot: fail any row left mid-pipeline by a previous crash so it stops rendering as
  // "in progress" with nothing driving it. Safe to run alongside the worker — it only touches
  // jobs that have no created/retry/active queue job at all.
  await reapStrandedJobs();

  const app = await buildApp(boss);

  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  logger.info({ port: config.PORT }, 'ingestion-automated service listening');
}

main().catch((err) => {
  console.error('Fatal startup error', err);
  process.exit(1);
});

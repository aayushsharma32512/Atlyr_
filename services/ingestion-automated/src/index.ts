import { config } from './config/index';
import { createLogger } from './utils/logger';
import { initBoss } from './queue/boss';
import { startWorker } from './queue/worker';
import { buildApp } from './api/index';

const logger = createLogger({ stage: 'bootstrap' });

async function main() {
  logger.info({}, 'starting ingestion-automated service');

  const boss = await initBoss(logger, {
    registerWorkers: (bossInstance) => {
      startWorker(bossInstance);
    },
  });

  const app = await buildApp(boss);

  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  logger.info({ port: config.PORT }, 'ingestion-automated service listening');
}

main().catch((err) => {
  console.error('Fatal startup error', err);
  process.exit(1);
});

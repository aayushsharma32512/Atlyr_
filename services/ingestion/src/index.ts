import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import type PgBoss from 'pg-boss';
import { config } from './config/index';
import { createLogger } from './utils/logger';
import { initBoss, withTestSubscriber } from './queue/boss';
import { registerSubmitUrlRoute } from './api/routes/submit-url';
import { registerJobStatusRoute } from './api/routes/job-status';
import { registerReviewActionsRoute } from './api/routes/review-actions';
import { registerPhase1Routes } from './api/routes/phase1';
import { registerPhase2Routes } from './api/routes/phase2';
import { createOperatorAuthHook } from './api/routes/auth';
import { registerOrchestratorWorker } from './orchestration/orchestrator.worker';
import { ensureBucketExists } from './adapters/storage/supabase-storage';
import { registerJobRoutes } from './api/routes/jobs';
import { findStaleQueuedJobs } from './domain/job-catalog';
import { readState } from './domain/state-store';
import { TOPICS } from './queue/topics';

async function main() {
  const logger = createLogger({ stage: 'bootstrap' });
  logger.info({ env: 'validated' }, 'Environment validated');

  await ensureBucketExists();
  const boss = await initBoss(logger, {
    registerWorkers: async (bossInstance, context) => {
      const generation = context?.generation ?? 0;
      await registerOrchestratorWorker(bossInstance, generation);
      if (config.NODE_ENV !== 'production') {
        await withTestSubscriber(bossInstance, logger); // subscribe a dummy topic to verify
      }
    }
  });
  await runStartupSweep(boss, logger);

  const app = Fastify({
    logger: false,
    // Allow larger JSON payloads (e.g., base64-encoded processed ghost uploads).
    bodyLimit: 30 * 1024 * 1024
  });
  await app.register(fastifyCors, {
    origin: true,
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
  app.get('/health', async () => ({ ok: true }));

  await registerSubmitUrlRoute(app, boss);
  const operatorHook = createOperatorAuthHook();

  await registerJobStatusRoute(app, operatorHook);
  await registerReviewActionsRoute(app, operatorHook);
  await registerPhase1Routes(app, boss, operatorHook);
  await registerPhase2Routes(app, boss, operatorHook);
  await registerJobRoutes(app, boss, operatorHook);

  const port = Number(process.env.PORT ?? 8787);
  await app.listen({ port, host: '0.0.0.0' });
  logger.info({ port }, 'Ingestion service listening');
}

const STALE_QUEUED_MINUTES = 2;

async function runStartupSweep(boss: PgBoss, logger: ReturnType<typeof createLogger>) {
  const cutoff = new Date(Date.now() - STALE_QUEUED_MINUTES * 60 * 1000).toISOString();
  let staleJobs;
  try {
    staleJobs = await findStaleQueuedJobs(cutoff);
  } catch (error) {
    logger.warn({ error: (error as Error)?.message }, 'Startup requeue sweep failed');
    return;
  }

  if (staleJobs.length === 0) {
    logger.info({ cutoff }, 'Startup requeue sweep found no stale jobs');
    return;
  }

  let requeued = 0;
  for (const job of staleJobs) {
    let state;
    try {
      state = await readState(job.job_id);
    } catch (error) {
      logger.warn({ jobId: job.job_id, error: (error as Error)?.message }, 'Startup requeue state load failed');
      continue;
    }
    if (!state) continue;

    const hasStep = typeof state.step === 'string' && state.step.trim().length > 0;
    const hasPause = Boolean(state.pause?.reason);
    const submitOnly = Boolean(state.flags?.submitReceived) && !hasStep && !hasPause;
    if (!submitOnly) continue;

    const singletonKey = job.dedupe_key
      ? `${TOPICS.ORCHESTRATOR}:${job.dedupe_key}`
      : `${TOPICS.ORCHESTRATOR}:${job.job_id}`;
    try {
      await boss.send(
        TOPICS.ORCHESTRATOR,
        { jobId: job.job_id },
        { singletonKey, retryLimit: 5, retryBackoff: true }
      );
      requeued += 1;
    } catch (error) {
      logger.warn({ jobId: job.job_id, error: (error as Error)?.message }, 'Startup requeue enqueue failed');
    }
  }

  logger.info({ scanned: staleJobs.length, requeued }, 'Startup requeue sweep complete');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal error starting ingestion service', err);
  process.exit(1);
});

import { getJob, markJobFailed } from '../domain/job-catalog';
import type { StepHandler } from '../domain/types';
import { PendingHandler } from '../steps/pending.handler';
import { createLogger } from '../utils/logger';

const logger = createLogger({ stage: 'dispatcher' });

// Populated incrementally as phases are built. States not listed here cause the
// job to fail immediately so it's obvious when a handler is missing.
const HANDLERS: Record<string, StepHandler> = {
  pending: new PendingHandler(),
  // scraping, identifying, ... added in Phase 2+
};

export async function dispatch(jobId: string): Promise<void> {
  const job = await getJob(jobId);
  const handler = HANDLERS[job.current_state];

  if (!handler) {
    const msg = `No handler registered for state: ${job.current_state}`;
    logger.error({ jobId, state: job.current_state }, msg);
    await markJobFailed(jobId, msg, job.current_state);
    return;
  }

  try {
    await handler.validate(job);
    await handler.execute(job);
  } catch (err) {
    const msg = (err as Error).message;
    logger.error({ jobId, state: job.current_state, error: msg }, 'Step failed');
    await markJobFailed(jobId, msg, job.current_state);
    // Re-throw so pg-boss marks the job as failed and can retry if configured
    throw err;
  }
}

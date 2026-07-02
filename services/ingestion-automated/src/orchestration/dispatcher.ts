import { getJob, markJobFailed } from '../domain/job-catalog';
import type { StepHandler } from '../domain/types';
import { PendingHandler } from '../steps/pending.handler';
import { ScrapingHandler } from '../steps/scraping.handler';
import { IdentificationHandler } from '../steps/identifying.handler';
import { GarmentSummaryHandler } from '../steps/garment-summary.handler';
import { createLogger } from '../utils/logger';

const logger = createLogger({ stage: 'dispatcher' });

const HANDLERS: Record<string, StepHandler> = {
  pending:                    new PendingHandler(),
  scraping:                   new ScrapingHandler(),
  identifying:                new IdentificationHandler(),
  generating_garment_summary: new GarmentSummaryHandler(),
  // generating_vton, segmenting, segmented added in Phase 3+
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

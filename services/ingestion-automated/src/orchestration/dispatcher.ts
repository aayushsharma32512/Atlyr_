import { TERMINAL_STATES, HITL_STATES, PARKED_STATES } from '../orchestration/state-machine';
import { getJob, markJobFailed } from '../domain/job-catalog';
import type { StepHandler } from '../domain/types';
import { PendingHandler } from '../steps/pending.handler';
import { ScrapingHandler } from '../steps/scraping.handler';
import { IdentificationHandler } from '../steps/identifying.handler';
import { GarmentSummaryHandler } from '../steps/garment-summary.handler';
import { VtonGenerationHandler } from '../steps/vton-generation.handler';
import { SegmentingHandler } from '../steps/segmenting.handler';
import { SegmentedHandler } from '../steps/segmented.handler';
import { PlacementHandler } from '../steps/placement.handler';
import { createLogger } from '../utils/logger';

const logger = createLogger({ stage: 'dispatcher' });

const HANDLERS: Record<string, StepHandler> = {
  pending:                    new PendingHandler(),
  scraping:                   new ScrapingHandler(),
  identifying:                new IdentificationHandler(),
  generating_garment_summary: new GarmentSummaryHandler(),
  generating_vton:            new VtonGenerationHandler(),
  segmenting:                 new SegmentingHandler(),
  segmented:                  new SegmentedHandler(),
  placement:                  new PlacementHandler(),
};

export async function dispatch(jobId: string): Promise<void> {
  const job = await getJob(jobId);

  if (TERMINAL_STATES.includes(job.current_state as never)) {
    logger.info({ jobId, state: job.current_state }, 'Job is in terminal state, skipping dispatch');
    return;
  }

  // A HITL state is a resting state waiting on a person, so it deliberately has no handler. Without
  // this guard it fell through to the "no handler registered" branch below and was marked FAILED —
  // any stray dispatch (a duplicate queue row, a pg-boss retry of an expired job) would destroy a
  // job that had already completed VTON and segmentation and was sitting in the review queue.
  if (HITL_STATES.includes(job.current_state as never)) {
    logger.info({ jobId, state: job.current_state }, 'Job is awaiting human input, skipping dispatch');
    return;
  }

  // Same argument, different waiter: a parked job has no handler by design either. The window is
  // far wider here — a batch park lasts hours, so a stale retry has much more time to land on one.
  if (PARKED_STATES.includes(job.current_state as never)) {
    logger.info({ jobId, state: job.current_state }, 'Job is parked awaiting an external result, skipping dispatch');
    return;
  }

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

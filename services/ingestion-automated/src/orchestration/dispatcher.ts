import { TERMINAL_STATES, HITL_STATES, PARKED_STATES } from '../orchestration/state-machine';
import { config } from '../config/index';
import { getJob, markJobFailed, markJobRetrying } from '../domain/job-catalog';
import { decideStepFailure } from './step-retry';
import { getBoss } from './advance-and-trigger';
import { sendPipelineStep } from '../queue/send-step';
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
    const boss = getBoss();

    // Not every error is a verdict. A rate limit or a transient upstream is a WAIT with a duration
    // the server usually names, and failing the job there is what killed 15 jobs on 2026-08-23 —
    // `failed` is terminal, so the pg-boss retries that followed all returned at the terminal-state
    // guard above without doing anything.
    const decision = decideStepFailure({
      err,
      errorCount: job.error_count,
      maxAttempts: config.STEP_MAX_ATTEMPTS,
      fallbackDelayMs: config.STEP_RETRY_FALLBACK_SECONDS * 1000,
    });

    if (decision.action === 'retry' && boss) {
      const delaySeconds = Math.ceil(decision.delayMs / 1000);
      // current_state is deliberately untouched, so the job stays non-terminal and the step below
      // is genuinely runnable again.
      await markJobRetrying(jobId, msg, job.current_state);
      await sendPipelineStep(boss, jobId, job.current_state, { startAfterSeconds: delaySeconds });
      logger.warn(
        { jobId, state: job.current_state, kind: decision.kind, attempt: decision.attempt,
          maxAttempts: config.STEP_MAX_ATTEMPTS, delaySeconds, error: msg },
        'step deferred — upstream asked us to wait, re-queued rather than failed',
      );
      // Swallowed on purpose: we have scheduled the replacement ourselves, so this queue job is
      // COMPLETE rather than failed. pg-boss's own retryLimit deliberately does not see these —
      // it exists for a worker dying mid-step, which is a different failure.
      return;
    }

    logger.error(
      { jobId, state: job.current_state, kind: decision.kind,
        reason: decision.action === 'fail' ? decision.reason : 'no-queue-handle', error: msg },
      'Step failed',
    );
    await markJobFailed(jobId, msg, job.current_state);
    // Re-throw so pg-boss marks the job as failed and can retry if configured
    throw err;
  }
}

import type PgBoss from 'pg-boss';
import { config } from '../config/index';

// The ONE place a pipeline step is enqueued. Every caller goes through here so the send-time
// options can't drift apart between the four entry points (submit, proceed, restart, and the
// automatic advance between steps).
//
// expireInSeconds was previously never set, so every job silently inherited pg-boss's 15-minute
// default — shorter than a segmentation behind a cold Modal container. When it lapsed pg-boss
// marked the job `expired` while the handler kept running, so the step completed against a job
// the queue had already given up on.
//
// retryLimit exists for ONE case: the worker process dying mid-step. There, dispatch()'s catch
// never runs, so markJobFailed is never called and current_state stays non-terminal — the retry
// re-runs the step and the row heals itself. It does NOT retry ordinary step failures: dispatch()
// marks the job failed (a terminal state) before rethrowing, so the retried dispatch returns at
// the terminal-state guard. Transient upstream errors are handled inside the adapters instead.
//
// Steps that hand off to Modal get a longer window. Expiry does not cancel the in-flight handler,
// so if the timeout lapses while Modal is still working, the retry runs CONCURRENTLY with the
// original — and SegmentingHandler deletes the existing segmentation_jobs row before inserting,
// so a concurrent retry would wipe the record of the run still in progress.
const MODAL_DRIVEN_STATES = new Set(['segmenting', 'placement']);

export function sendPipelineStep(
  boss: PgBoss,
  jobId: string,
  targetState?: string,
): Promise<string | null> {
  const expireInSeconds = targetState && MODAL_DRIVEN_STATES.has(targetState)
    ? config.BOSS_MODAL_STEP_TIMEOUT_SECONDS
    : config.BOSS_STEP_TIMEOUT_SECONDS;

  return boss.send(
    'run-pipeline-step',
    { jobId },
    {
      expireInSeconds,
      retryLimit: config.BOSS_STEP_RETRY_LIMIT,
      retryDelay: config.BOSS_STEP_RETRY_DELAY_SECONDS,
      retryBackoff: true,
    },
  );
}

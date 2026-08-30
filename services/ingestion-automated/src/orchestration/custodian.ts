/**
 * The periodic pass that makes every wait in the pipeline someone's responsibility.
 *
 * Three rescue paths existed before this and none of them ran at steady state:
 *
 *   - boot recovery resumes orphans, but only at boot (its safety argument depends on having
 *     consumed nothing yet). A row stranded while the service stayed UP was never looked at again.
 *   - the reaper fails long-abandoned rows, but it too ran only at boot, and REAPER_MODE defaulted
 *     to 'log' — so it had, in practice, never acted at all.
 *   - `segmenting` / `placement` are excluded from both, correctly, because Modal patches
 *     current_state out of band. But nothing else bounded them either: if the container also died,
 *     the row sat in `segmenting` forever with no deadline and no owner.
 *
 * The batch lane already solved exactly this shape — the poller self-expires a tray past 48h even
 * when the provider is unreachable, precisely so an unanswerable handoff cannot hold jobs forever.
 * This gives the Modal handoff the same treatment, and puts the other two on a clock.
 */
import { pgPool } from '../db/pg';
import { config } from '../config/index';
import { getJob, markJobFailed } from '../domain/job-catalog';
import { isRecoverableFailure } from './step-retry';
import { restartJobFromStep, STEP_ORDER, type RestartableState } from './restart-job';
import { MODAL_DRIVEN_STATES } from './recovery-scope';
import { recoverOrphanedJobs } from './boot-recovery';
import { reapStrandedJobs } from './reaper';
import { PIPELINE_QUEUE, MODAL_QUEUE } from '../queue/send-step';
import type { BossHandle } from '../queue/boss';
import { createLogger } from '../utils/logger';

const logger = createLogger({ stage: 'custodian' });

export interface CustodianResult {
  resumed: number;
  clearedQueueRows: number;
  modalTimedOut: number;
  reaped: number;
  failuresRetried: number;
}

interface StuckModalRow {
  job_id: string;
  current_state: string;
  idle_seconds: number;
}

/**
 * Modal rows that have outlived any plausible run and have nothing backing them.
 *
 * The threshold is the Modal step timeout plus the same grace the reaper uses, NOT the ordinary
 * step timeout: a cold container plus a 2K segmentation legitimately runs for many minutes, and
 * failing live work is far worse than leaving a corpse one more tick.
 */
export async function findTimedOutModalJobs(): Promise<StuckModalRow[]> {
  const idleSeconds = config.BOSS_MODAL_STEP_TIMEOUT_SECONDS + config.BOSS_REAP_GRACE_SECONDS;

  const { rows } = await pgPool().query<StuckModalRow>(
    `select j.job_id::text  as job_id,
            j.current_state as current_state,
            extract(epoch from now() - j.updated_at)::int as idle_seconds
       from ingestion_pipeline_jobs j
      where j.current_state = any($1::text[])
        and now() - j.updated_at > make_interval(secs => $2::int)
        and not exists (
          select 1
            from ${config.BOSS_SCHEMA}.job b
           where b.name = any($3::text[])
             and b.state in ('created', 'retry', 'active')
             and b.data->>'jobId' = j.job_id::text)
      order by j.updated_at asc`,
    [MODAL_DRIVEN_STATES, idleSeconds, [PIPELINE_QUEUE, MODAL_QUEUE]],
  );
  return rows;
}

/**
 * FAILED, not re-dispatched, and that is deliberate. The Modal app writes `segmentation_jobs`
 * itself, and SegmentingHandler deletes the existing row before inserting — so a re-dispatch that
 * races a container which is somehow still alive would wipe the record of the live run. Failing
 * surfaces the job in the UI on the existing "Restart from step" path, where a human decides.
 */
async function failTimedOutModalJobs(): Promise<number> {
  const stuck = await findTimedOutModalJobs();
  if (stuck.length === 0) return 0;

  let failed = 0;
  for (const row of stuck) {
    try {
      await markJobFailed(
        row.job_id,
        `Stuck in '${row.current_state}' for ${Math.round(row.idle_seconds / 60)}m with no Modal run ` +
          'backing it — the GPU container or this worker died mid-step. Restart from this step to retry.',
        row.current_state,
      );
      failed += 1;
      logger.warn({ jobId: row.job_id, state: row.current_state, idleSeconds: row.idle_seconds }, 'failed a timed-out Modal job');
    } catch (err) {
      logger.error({ jobId: row.job_id, error: (err as Error).message }, 'could not fail timed-out Modal job');
    }
  }
  return failed;
}


interface RecoverableRow {
  job_id: string;
  last_error: string | null;
  last_error_step: string | null;
  error_count: number;
}

/**
 * Failed jobs that deserve another go.
 *
 * `failed` is terminal on purpose, and most of the time that is right: a 404 or a malformed URL
 * never heals, and re-driving it forever would burn scrape credits on work that cannot succeed.
 * But some failures are about CONDITIONS, not about the job — an exhausted API key, a rate limit
 * that outlasted the dispatcher's patience, an upstream that was down. Those heal, and until now
 * nothing in the system would ever look at them again: a human had to notice and click restart.
 *
 * The idle floor matters as much as the predicate. Retrying the instant a job fails would fight
 * the operator who is looking at it, and would re-ask an upstream that is still broken; waiting
 * gives the condition time to actually change.
 */
async function findRecoverableFailures(): Promise<RecoverableRow[]> {
  const { rows } = await pgPool().query<RecoverableRow>(
    `select j.job_id::text      as job_id,
            j.last_error        as last_error,
            j.last_error_step   as last_error_step,
            j.error_count       as error_count
       from ingestion_pipeline_jobs j
      where j.current_state = 'failed'
        and j.last_error is not null
        and j.last_error_step = any($1::text[])
        and j.error_count < $2::int
        and now() - j.updated_at > make_interval(secs => $3::int)
      order by j.updated_at asc
      limit 50`,
    [STEP_ORDER as unknown as string[], config.AUTO_RETRY_MAX_ATTEMPTS, config.AUTO_RETRY_MIN_IDLE_SECONDS],
  );
  // The predicate that decides "worth another go" lives in a pure module so the drills can test it;
  // the stored message is re-wrapped as an Error because that is what the classifier reads.
  return rows.filter((r) => isRecoverableFailure(new Error(r.last_error ?? '')));
}

async function retryRecoverableFailures(boss: BossHandle): Promise<number> {
  if (!config.AUTO_RETRY_FAILED) return 0;

  const candidates = await findRecoverableFailures();
  let retried = 0;

  for (const row of candidates) {
    try {
      const job = await getJob(row.job_id);
      // Re-read rather than trusting the scan: minutes may have passed, and a human may have
      // restarted it in the meantime. Only a still-failed row is ours to touch.
      if (job.current_state !== 'failed') continue;

      // error_count is deliberately NOT reset — that is what bounds this loop. A human restart
      // resets it and grants a fresh budget; the custodian only ever spends the existing one.
      await restartJobFromStep(boss, job, row.last_error_step as RestartableState, {
        resetErrorCount: false,
      });
      retried += 1;
      logger.warn(
        { jobId: row.job_id, fromState: row.last_error_step, attempt: row.error_count,
          maxAttempts: config.AUTO_RETRY_MAX_ATTEMPTS, error: (row.last_error ?? '').slice(0, 120) },
        'retried a recoverable failure — the condition may have cleared since',
      );
    } catch (err) {
      logger.error({ jobId: row.job_id, error: (err as Error).message }, 'could not retry failed job');
    }
  }
  return retried;
}

/**
 * One tick. Each pass is independent and failures are contained: a broken pass must not stop the
 * other two, and none of them may ever take the service down.
 */
export async function runCustodian(boss: BossHandle): Promise<CustodianResult> {
  const result: CustodianResult = { resumed: 0, clearedQueueRows: 0, modalTimedOut: 0, reaped: 0, failuresRetried: 0 };
  if (!config.CUSTODIAN_ENABLED) return result;

  // 1. Resume orphans. Unlike boot, workers are consuming right now, so an `active` row is far more
  //    likely to be a step in progress than a corpse — only rows that have outlived what a step is
  //    allowed to take may be assumed dead. This is the same threshold POST /jobs/recover uses.
  try {
    const recovered = await recoverOrphanedJobs(
      boss,
      config.BOOT_RECOVERY === 'off' ? 'off' : 'resume',
      config.BOSS_STEP_TIMEOUT_SECONDS + config.BOSS_REAP_GRACE_SECONDS,
    );
    result.resumed = recovered.resumed;
    result.clearedQueueRows = recovered.cleared;
  } catch (err) {
    logger.error({ error: (err as Error).message }, 'orphan resume pass failed');
  }

  // 2. Bound the Modal handoff — the gap that had no owner at all.
  try {
    result.modalTimedOut = await failTimedOutModalJobs();
  } catch (err) {
    logger.error({ error: (err as Error).message }, 'modal deadline pass failed');
  }

  // 3. Fail long-abandoned rows in states this worker drives start to finish.
  try {
    result.reaped = await reapStrandedJobs();
  } catch (err) {
    logger.error({ error: (err as Error).message }, 'reap pass failed');
  }

  // 4. Give failures that were about CONDITIONS rather than about the job another go. Runs last so
  //    it never re-drives something an earlier pass has just touched in this same tick.
  try {
    result.failuresRetried = await retryRecoverableFailures(boss);
  } catch (err) {
    logger.error({ error: (err as Error).message }, 'failure retry pass failed');
  }

  return result;
}

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
import { markJobFailed } from '../domain/job-catalog';
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

/**
 * One tick. Each pass is independent and failures are contained: a broken pass must not stop the
 * other two, and none of them may ever take the service down.
 */
export async function runCustodian(boss: BossHandle): Promise<CustodianResult> {
  const result: CustodianResult = { resumed: 0, clearedQueueRows: 0, modalTimedOut: 0, reaped: 0 };
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

  return result;
}

import { pgPool } from '../db/pg';
import { config } from '../config/index';
import { markJobFailed } from '../domain/job-catalog';
import { HITL_STATES, TERMINAL_STATES } from './state-machine';
import { createLogger } from '../utils/logger';

const logger = createLogger({ stage: 'reaper' });

// A job row can be left mid-pipeline with nothing to drive it forward:
//
//   - the worker process dies inside a step. dispatch()'s catch never runs (a killed process does
//     not unwind), so markJobFailed is never called and current_state stays e.g. 'segmenting'.
//     The pg-boss job expires and — with retryLimit at its default 0 — stays expired.
//   - the process dies in advance-and-trigger between updateState and the send, so the row moves
//     to the next state and no queue job is ever created for it.
//
// Either way the row is unreachable: in progress, but no live pg-boss job anywhere. The dashboard
// renders it as "Segmenting…" forever, with no error and nothing working on it.
//
// CAVEAT — "no pg-boss job" does NOT mean "stranded" for every state. Two steps hand off to a
// Modal app that patches ingestion_pipeline_jobs.current_state directly, out of band:
//   - segmenting: pipeline/db_store.py update_parent_job_url() writes current_state='segmented'
//   - placement:  the Modal placement pipeline patches current_state as a side effect
// A row can therefore sit legitimately in one of those states, for as long as Modal takes, with no
// queue job backing it. Reaping those is a false positive that fails live work — so they are
// excluded outright. Only states driven start-to-finish by this worker are eligible.
//
// Eligible rows are FAILED, not re-enqueued: a step that died halfway may have left partial
// artifacts behind, and silently re-running it would hide that a crash happened at all. Failing
// surfaces them in the UI with the existing "↻ Restart from <step>" recovery path.
const EXTERNALLY_DRIVEN_STATES = ['segmenting', 'placement'];
interface StrandedRow {
  job_id: string;
  current_state: string;
  idle_seconds: number;
}

export async function findStrandedJobs(): Promise<StrandedRow[]> {
  // Only consider a row stranded once it has been idle for longer than a step is allowed to take.
  // Anything younger could legitimately still be running — expiry does not cancel the handler,
  // so an in-flight step can outlive its own pg-boss job.
  const idleSeconds = config.BOSS_STEP_TIMEOUT_SECONDS + config.BOSS_REAP_GRACE_SECONDS;

  const { rows } = await pgPool().query<StrandedRow>(
    `select j.job_id::text        as job_id,
            j.current_state       as current_state,
            extract(epoch from now() - j.updated_at)::int as idle_seconds
       from ingestion_pipeline_jobs j
      where j.current_state <> all($1::text[])
        and j.current_state <> all($2::text[])
        and j.current_state <> all($4::text[])
        and now() - j.updated_at > make_interval(secs => $3::int)
        and not exists (
          select 1
            from ${config.BOSS_SCHEMA}.job b
           where b.name = 'run-pipeline-step'
             and b.state in ('created', 'retry', 'active')
             and b.data->>'jobId' = j.job_id::text)
      order by j.updated_at asc`,
    [TERMINAL_STATES, HITL_STATES, idleSeconds, EXTERNALLY_DRIVEN_STATES],
  );

  return rows;
}

// Runs once at boot, before the worker registers. Assumes a single worker instance — with two,
// a booting instance would reap jobs the other one is actively running. Guard on instance
// ownership before scaling out.
export async function reapStrandedJobs(): Promise<number> {
  if (config.REAPER_MODE === 'off') return 0;

  let stranded: StrandedRow[];
  try {
    stranded = await findStrandedJobs();
  } catch (err) {
    // Never block startup on the reaper — a failure here leaves rows stuck, which is the status
    // quo, whereas throwing would take the whole service down with it.
    logger.error({ error: (err as Error).message }, 'stranded-job scan failed, skipping');
    return 0;
  }

  if (stranded.length === 0) {
    logger.info({}, 'no stranded jobs');
    return 0;
  }

  if (config.REAPER_MODE === 'log') {
    logger.warn(
      { count: stranded.length, jobs: stranded },
      'stranded job candidates (REAPER_MODE=log — nothing changed; set REAPER_MODE=fail to act)',
    );
    return 0;
  }

  for (const row of stranded) {
    try {
      await markJobFailed(
        row.job_id,
        `Stranded in '${row.current_state}' with no active queue job for ${Math.round(row.idle_seconds / 60)}m ` +
          '— the worker most likely restarted mid-step. Restart from this step to retry.',
        row.current_state,
      );
      logger.warn(
        { jobId: row.job_id, state: row.current_state, idleSeconds: row.idle_seconds },
        'reaped stranded job',
      );
    } catch (err) {
      logger.error({ jobId: row.job_id, error: (err as Error).message }, 'failed to reap job');
    }
  }

  logger.info({ count: stranded.length }, 'stranded jobs reaped');
  return stranded.length;
}

import { pgPool } from '../db/pg';
import { config } from '../config/index';
import { HITL_STATES, TERMINAL_STATES } from './state-machine';
import { EXTERNALLY_DRIVEN_STATES } from './recovery-scope';
import { PIPELINE_QUEUE, MODAL_QUEUE, sendPipelineStep } from '../queue/send-step';
import type { BossHandle } from '../queue/boss';
import { createLogger } from '../utils/logger';

const logger = createLogger({ stage: 'boot-recovery' });

// Picks up work the previous process was holding when it died, so a crash or a Ctrl-C never needs
// a human to re-drive a batch by hand.
//
// This is deliberately separate from the reaper, which answers a different question. The reaper
// looks for rows idle longer than a step is allowed to take and FAILS them, because at steady state
// it cannot tell "still running" from "abandoned" and re-running a half-finished step could hide a
// crash. At boot that ambiguity is gone: this process has just started and has consumed nothing, so
// under the single-instance assumption every pg-boss row still marked `active` was owned by a
// process that no longer exists. Nothing is running it, and nothing ever will — pg-boss will not
// touch it until expireInSeconds lapses (30 minutes for a normal step, 90 for a Modal one).
//
// MUST run before the workers register, or this process's own in-flight jobs look identical to a
// dead process's and get recovered out from under themselves.
//
// Externally driven states are excluded, and the list is SHARED with the reaper rather than
// copied — see recovery-scope.ts. It used to be copied, and the copies drifted: this one was
// missing the parked states, so every job sitting in a batch tray (which by design never has a
// queue row) matched as an orphan and was re-dispatched on every boot.

type OrphanRow = {
  job_id: string;
  current_state: string;
  stale_queue_ids: string[];
};

export type BootRecoveryResult = {
  resumed: number;
  cleared: number;
  candidates: OrphanRow[];
};

/**
 * Rows that nothing is driving: either a queue job left `active` by a dead process, or a
 * non-terminal row with no queue job at all (the process died between updateState and the send).
 *
 * `staleActiveAfterSeconds` decides when an `active` row counts as a corpse rather than as work in
 * progress, and it is the whole difference between the two callers:
 *
 *   0    — boot. This process has consumed nothing yet, so every `active` row belongs to a process
 *          that no longer exists. Recovering immediately is safe and is the point of the exercise.
 *   >0   — steady state (the manual endpoint). Here `active` usually means "running right now", so
 *          only a row that has outlived what a step is allowed to take can be assumed dead.
 *          Getting this wrong cancels and re-dispatches live work.
 */
export async function findOrphanedJobs(staleActiveAfterSeconds = 0): Promise<OrphanRow[]> {
  const { rows } = await pgPool().query<OrphanRow>(
    `select j.job_id::text  as job_id,
            j.current_state as current_state,
            coalesce(
              array_agg(b.id::text) filter (
                where b.state = 'active'
                  and b.startedon <= now() - make_interval(secs => $5::int)
              ),
              '{}'
            ) as stale_queue_ids
       from ingestion_pipeline_jobs j
       left join ${config.BOSS_SCHEMA}.job b
              on b.data->>'jobId' = j.job_id::text
             and b.name = any($4::text[])
             and b.state in ('created', 'retry', 'active')
      where j.current_state <> all($1::text[])
        and j.current_state <> all($2::text[])
        and j.current_state <> all($3::text[])
      group by j.job_id, j.current_state
        -- Orphaned means nothing alive is backing it: no queued row waiting to run, and no active
        -- row young enough to still be running.
        having count(b.id) filter (
                 where b.state in ('created', 'retry')
                    or (b.state = 'active' and b.startedon > now() - make_interval(secs => $5::int))
               ) = 0
      order by j.updated_at asc`,
    [
      TERMINAL_STATES,
      HITL_STATES,
      EXTERNALLY_DRIVEN_STATES,
      [PIPELINE_QUEUE, MODAL_QUEUE],
      Math.max(0, Math.trunc(staleActiveAfterSeconds)),
    ],
  );
  return rows;
}

/**
 * Cancels the dead process's queue rows and re-dispatches each job at the step it stopped on.
 * Returns counts so the caller can log or surface them.
 */
export async function recoverOrphanedJobs(
  boss: BossHandle,
  mode: 'off' | 'log' | 'resume' = config.BOOT_RECOVERY,
  staleActiveAfterSeconds = 0,
): Promise<BootRecoveryResult> {
  const empty: BootRecoveryResult = { resumed: 0, cleared: 0, candidates: [] };
  if (mode === 'off') return empty;

  let candidates: OrphanRow[];
  try {
    candidates = await findOrphanedJobs(staleActiveAfterSeconds);
  } catch (err) {
    // Never block startup on recovery — failing here leaves rows stuck, which is the status quo,
    // whereas throwing would take the service down with it.
    logger.error({ error: (err as Error).message }, 'orphan scan failed, skipping');
    return empty;
  }

  if (candidates.length === 0) {
    logger.info({}, 'no orphaned jobs');
    return empty;
  }

  if (mode === 'log') {
    logger.warn(
      { count: candidates.length, jobs: candidates },
      'orphaned jobs found (BOOT_RECOVERY=log — nothing changed; set BOOT_RECOVERY=resume to act)',
    );
    return { ...empty, candidates };
  }

  let resumed = 0;
  let cleared = 0;
  for (const row of candidates) {
    try {
      // Cancel first. If the re-dispatch below succeeded while the corpse was still `active`, the
      // job would hold two queue rows and the old one would fire again on expiry.
      if (row.stale_queue_ids.length > 0) {
        await boss.cancel(row.stale_queue_ids);
        cleared += row.stale_queue_ids.length;
      }
      await sendPipelineStep(boss, row.job_id, row.current_state);
      resumed += 1;
      logger.info({ jobId: row.job_id, state: row.current_state, clearedQueueRows: row.stale_queue_ids.length }, 'resumed orphaned job');
    } catch (err) {
      logger.error({ jobId: row.job_id, error: (err as Error).message }, 'failed to resume orphaned job');
    }
  }

  logger.info({ resumed, cleared, candidates: candidates.length }, 'boot recovery complete');
  return { resumed, cleared, candidates };
}

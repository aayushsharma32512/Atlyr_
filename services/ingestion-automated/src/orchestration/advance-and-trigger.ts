import type PgBoss from 'pg-boss';
import { updateState } from '../domain/job-catalog';
import type { IngestionPipelineJob } from '../domain/types';
import { nextState, HITL_STATES } from './state-machine';

let _boss: PgBoss;

export function setBoss(boss: PgBoss) {
  _boss = boss;
}

export async function advanceAndTrigger(job: IngestionPipelineJob): Promise<void> {
  const next = nextState(job);
  await updateState(job.job_id, next);

  if (HITL_STATES.includes(next)) return;

  await _boss.send('run-pipeline-step', { jobId: job.job_id });
}

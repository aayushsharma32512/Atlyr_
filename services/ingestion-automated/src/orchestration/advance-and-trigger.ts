import type PgBoss from 'pg-boss';
import { updateState } from '../domain/job-catalog';
import type { IngestionPipelineJob } from '../domain/types';
import { nextState, HITL_STATES } from './state-machine';
import { sendPipelineStep } from '../queue/send-step';

let _boss: PgBoss;

export function setBoss(boss: PgBoss) {
  _boss = boss;
}

export async function advanceAndTrigger(job: IngestionPipelineJob): Promise<void> {
  const next = nextState(job);
  await updateState(job.job_id, next);

  if (HITL_STATES.includes(next)) return;

  await sendPipelineStep(_boss, job.job_id, next);
}

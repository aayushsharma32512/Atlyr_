import type { BossHandle } from '../queue/boss';
import { updateState } from '../domain/job-catalog';
import type { IngestionPipelineJob } from '../domain/types';
import { nextState, NO_ENQUEUE_STATES } from './state-machine';
import { sendPipelineStep } from '../queue/send-step';

let _boss: BossHandle;

export function setBoss(boss: BossHandle) {
  _boss = boss;
}

/**
 * The same handle, for the other places in orchestration that need to enqueue. Undefined until
 * startWorker has run — callers must cope, so a unit test that never wired a queue still works.
 */
export function getBoss(): BossHandle | undefined {
  return _boss;
}

export async function advanceAndTrigger(job: IngestionPipelineJob): Promise<void> {
  const next = nextState(job);
  await updateState(job.job_id, next);

  // A parked or HITL state is entered and then left alone — the row is the record, and something
  // out of band (a human, or the batch poller) drives it onward.
  if (NO_ENQUEUE_STATES.includes(next)) return;

  await sendPipelineStep(_boss, job.job_id, next);
}

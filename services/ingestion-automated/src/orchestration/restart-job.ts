/**
 * Re-driving a job from a given step — the shared core of the manual restart route and the
 * custodian's automatic retry.
 *
 * It lives here rather than in the route because the two paths must not drift. That drift is
 * exactly what F1 was: boot recovery and the reaper each kept their own copy of a state list, the
 * copies diverged, and a rescue pass started treating paid-for work as a corpse. One caller with a
 * flag beats two implementations of the same delicate cleanup.
 */
import { deleteArtifactsForSteps } from '../domain/artifacts';
import { supabaseAdmin } from '../db/supabase';
import { PARKED_STATE } from '../domain/gemini-batches';
import { sendPipelineStep } from '../queue/send-step';
import type { BossHandle } from '../queue/boss';
import type { IngestionPipelineJob } from '../domain/types';

/** Ordered work states — decides which artifacts are downstream of the restart point. */
export const STEP_ORDER = [
  'scraping',
  'identifying',
  'generating_garment_summary',
  'generating_vton',
  'segmenting',
  'placement',
] as const;

export type RestartableState = typeof STEP_ORDER[number];

export interface RestartOptions {
  /**
   * A HUMAN restart clears error_count: the operator looked at it and is granting a fresh budget.
   *
   * An AUTOMATIC retry must not, or the custodian and its own cap chase each other forever — every
   * sweep would zero the very counter that decides whether to sweep again, and a permanently broken
   * upstream would cycle jobs until someone noticed the bill.
   */
  resetErrorCount: boolean;
}

async function cleanSegmentationData(jobId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('segmentation_jobs')
    .delete()
    .eq('pipeline_job_id', jobId);
  if (error) throw new Error(`Failed to clean segmentation data: ${error.message}`);
}

export async function restartJobFromStep(
  boss: BossHandle,
  job: IngestionPipelineJob,
  fromState: RestartableState,
  opts: RestartOptions,
): Promise<void> {
  const jobId = job.job_id;
  const fromIndex = STEP_ORDER.indexOf(fromState);
  const stepsToClean = STEP_ORDER.slice(fromIndex) as unknown as string[];

  await deleteArtifactsForSteps(jobId, stepsToClean);

  if (fromIndex <= STEP_ORDER.indexOf('segmenting')) {
    await cleanSegmentationData(jobId);
  }

  if (fromIndex < STEP_ORDER.indexOf('placement') && job.ingested_product_id) {
    await supabaseAdmin
      .from('ingestion_pipeline_jobs')
      .update({ ingested_product_id: null })
      .eq('job_id', jobId);
  }

  await supabaseAdmin
    .from('ingestion_pipeline_jobs')
    .update({
      current_state: fromState,
      last_error: null,
      last_error_step: null,
      ...(opts.resetErrorCount ? { error_count: 0 } : {}),
      // Releasing the tray claim is unconditional — it is what makes a late batch result for this
      // job harmless (the poller's ownership guard then matches zero rows).
      //
      // The LANE is only forced back to instant when the job is actually parked, i.e. someone is
      // saying "stop waiting for the tray, do it now". A job that failed upstream of the batch
      // station keeps the lane it was submitted with: silently flipping those to instant would
      // bill an economy sheet at full interactive price for every transient scrape error.
      ...(job.current_state === PARKED_STATE ? { vton_lane: 'instant' as const } : {}),
      gemini_batch_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq('job_id', jobId);

  await sendPipelineStep(boss, jobId, fromState);
}

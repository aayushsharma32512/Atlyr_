import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type PgBoss from 'pg-boss';
import { z } from 'zod';
import { getJob, updateState } from '../../domain/job-catalog';
import { deleteArtifactsForSteps } from '../../domain/artifacts';
import { hasTransition, HITL_STATES, TERMINAL_STATES } from '../../orchestration/state-machine';
import { supabaseAdmin } from '../../db/supabase';
import { createLogger } from '../../utils/logger';

const logger = createLogger({ stage: 'api:restart' });

// Ordered list of work states — used to determine which artifacts to clean.
const STEP_ORDER = [
  'scraping',
  'identifying',
  'generating_garment_summary',
  'generating_vton',
  'segmenting',
  'segmented',
] as const;

type RestartableState = typeof STEP_ORDER[number];

const RestartBody = z.object({
  from_state: z.enum(STEP_ORDER),
});

async function cleanSegmentationData(jobId: string): Promise<void> {
  // Delete segmentation_step_results via cascade when we delete segmentation_jobs
  const { error } = await supabaseAdmin
    .from('segmentation_jobs')
    .delete()
    .eq('pipeline_job_id', jobId);
  if (error) throw new Error(`Failed to clean segmentation data: ${error.message}`);
}

export async function registerRestartRoute(app: FastifyInstance, boss: PgBoss): Promise<void> {
  app.post('/jobs/:jobId/restart', async (req: FastifyRequest, reply: FastifyReply) => {
    const { jobId } = req.params as { jobId: string };

    const parsed = RestartBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Invalid from_state',
        valid_states: STEP_ORDER,
        details: parsed.error.flatten(),
      });
    }

    const { from_state } = parsed.data;

    const job = await getJob(jobId).catch(() => null);
    if (!job) return reply.status(404).send({ error: 'Job not found' });

    if (!hasTransition(from_state)) {
      return reply.status(400).send({ error: `Cannot restart from state: ${from_state}` });
    }

    // Prevent restart if job is mid-flight on a non-terminal, non-HITL state
    // (it could be actively processing — let it finish or fail first)
    const isActive = !TERMINAL_STATES.includes(job.current_state as never)
      && !HITL_STATES.includes(job.current_state as never)
      && job.current_state !== 'pending'
      && !STEP_ORDER.includes(job.current_state as RestartableState);

    if (isActive) {
      return reply.status(409).send({
        error: 'Job appears to be actively processing',
        current_state: job.current_state,
        hint: 'Wait for the job to reach a failed or HITL state before restarting',
      });
    }

    // Determine which step artifacts to delete (current step and all downstream)
    const fromIndex = STEP_ORDER.indexOf(from_state);
    const stepsToClean = STEP_ORDER.slice(fromIndex) as unknown as string[];

    logger.info({ jobId, from_state, stepsToClean }, 'restarting job');

    await deleteArtifactsForSteps(jobId, stepsToClean);

    // Clean segmentation tables if restarting at or before segmenting
    if (fromIndex <= STEP_ORDER.indexOf('segmenting')) {
      await cleanSegmentationData(jobId);
    }

    // If restarting before segmented, also clear the ingested_product link
    if (fromIndex < STEP_ORDER.indexOf('segmented') && job.ingested_product_id) {
      await supabaseAdmin
        .from('ingestion_pipeline_jobs')
        .update({ ingested_product_id: null })
        .eq('job_id', jobId);
    }

    await supabaseAdmin
      .from('ingestion_pipeline_jobs')
      .update({
        current_state: from_state,
        last_error: null,
        last_error_step: null,
        error_count: 0,
        updated_at: new Date().toISOString(),
      })
      .eq('job_id', jobId);

    await boss.send('run-pipeline-step', { jobId });

    logger.info({ jobId, from_state }, 'job restarted');
    return reply.send({
      job_id: jobId,
      restarted_from: from_state,
      previous_state: job.current_state,
    });
  });
}

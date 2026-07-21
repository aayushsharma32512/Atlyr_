import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type PgBoss from 'pg-boss';
import { z } from 'zod';
import type { PipelineState } from '../../domain/types';
import { getJob, updateJob } from '../../domain/job-catalog';
import { nextState, HITL_STATES } from '../../orchestration/state-machine';
import { updateState } from '../../domain/job-catalog';
import { createLogger } from '../../utils/logger';

const logger = createLogger({ stage: 'api:proceed' });

const ProceedBody = z.object({
  vton_image_override:      z.string().url().optional(),
  segmented_image_override: z.string().url().optional(),
});

const PROCEED_ALLOWED_STATES = ['awaiting_hitl_identification', 'awaiting_hitl_segmentation', 'placement'];

export async function registerProceedRoute(app: FastifyInstance, boss: PgBoss): Promise<void> {
  app.post('/jobs/:jobId/proceed', async (req: FastifyRequest, reply: FastifyReply) => {
    const { jobId } = req.params as { jobId: string };

    const parsed = ProceedBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request', details: parsed.error.flatten() });
    }
    const body = parsed.data;

    const job = await getJob(jobId).catch(() => null);
    if (!job) return reply.status(404).send({ error: 'Job not found' });

    if (!PROCEED_ALLOWED_STATES.includes(job.current_state)) {
      return reply.status(409).send({
        error: `Job is not awaiting HITL review`,
        current_state: job.current_state,
        allowed_states: PROCEED_ALLOWED_STATES,
      });
    }

    // Apply admin overrides before advancing
    const updates: Record<string, string> = {};
    if (body.vton_image_override) {
      updates['v_ton_preferred_image'] = body.vton_image_override;
    }
    if (body.segmented_image_override) {
      updates['segmented_image_url'] = body.segmented_image_override;
    }
    if (Object.keys(updates).length > 0) {
      await updateJob(jobId, updates);
    }

    const updatedJob = { ...job, ...updates };

    let next: PipelineState;
    if (job.current_state === 'placement') {
      next = 'placement';
    } else {
      next = nextState(updatedJob);
      await updateState(jobId, next);
    }

    // Enqueue step execution if not paused on HITL
    if (!HITL_STATES.includes(next)) {
      await boss.send('run-pipeline-step', { jobId });
    }

    logger.info({ jobId, from: job.current_state, to: next }, 'HITL proceed / trigger');
    return reply.send({ job_id: jobId, previous_state: job.current_state, current_state: next });
  });
}

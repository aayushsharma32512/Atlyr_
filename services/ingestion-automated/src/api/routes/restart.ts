import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { BossHandle } from '../../queue/boss';
import { z } from 'zod';
import { getJob, updateState } from '../../domain/job-catalog';
import { restartJobFromStep, STEP_ORDER, type RestartableState } from '../../orchestration/restart-job';
import { hasTransition, HITL_STATES, PARKED_STATES, TERMINAL_STATES } from '../../orchestration/state-machine';
import { PARKED_STATE } from '../../domain/gemini-batches';
import { supabaseAdmin } from '../../db/supabase';
import { sendPipelineStep } from '../../queue/send-step';
import { createLogger } from '../../utils/logger';

const logger = createLogger({ stage: 'api:restart' });


const RestartBody = z.object({
  from_state: z.enum(STEP_ORDER),
});

export async function registerRestartRoute(app: FastifyInstance, boss: BossHandle): Promise<void> {
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
    // (it could be actively processing — let it finish or fail first).
    // 'segmented' is a stable RESTING state (segmentation done, awaiting the placement
    // dispatch), not active work — so it must be restartable. Otherwise a job orphaned at
    // 'segmented' (e.g. the service restarted before the segmented→placement dispatch fired)
    // is unrecoverable: neither restart nor proceed accepts it.
    const isActive = !TERMINAL_STATES.includes(job.current_state as never)
      && !HITL_STATES.includes(job.current_state as never)
      && job.current_state !== 'pending'
      && job.current_state !== 'segmented'
      // A parked job is resting, not working: it is sitting in a batch tray with nothing in this
      // service driving it. Without this it 409s and is unrecoverable from the UI for up to 48h.
      && !PARKED_STATES.includes(job.current_state as never)
      && !STEP_ORDER.includes(job.current_state as RestartableState);

    if (isActive) {
      return reply.status(409).send({
        error: 'Job appears to be actively processing',
        current_state: job.current_state,
        hint: 'Wait for the job to reach a failed or HITL state before restarting',
      });
    }

    const stepsToClean = STEP_ORDER.slice(STEP_ORDER.indexOf(from_state)) as unknown as string[];
    logger.info({ jobId, from_state, stepsToClean }, 'restarting job');

    // resetErrorCount: a human looked at this and is granting a fresh retry budget. The custodian's
    // automatic path passes false — see orchestration/restart-job.
    await restartJobFromStep(boss, job, from_state, { resetErrorCount: true });

    logger.info({ jobId, from_state }, 'job restarted');
    return reply.send({
      job_id: jobId,
      restarted_from: from_state,
      previous_state: job.current_state,
    });
  });
}

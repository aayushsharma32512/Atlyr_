import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { BossHandle } from '../../queue/boss';
import { z } from 'zod';
import type { PipelineState } from '../../domain/types';
import { getJob, updateJob } from '../../domain/job-catalog';
import { nextState, HITL_STATES, NO_ENQUEUE_STATES, TERMINAL_STATES } from '../../orchestration/state-machine';
import { updateState } from '../../domain/job-catalog';
import { sendPipelineStep } from '../../queue/send-step';
import { createLogger } from '../../utils/logger';

const logger = createLogger({ stage: 'api:proceed' });

const ProceedBody = z.object({
  vton_image_override:      z.string().url().optional(),
  segmented_image_override: z.string().url().optional(),
});

// Derived from HITL_STATES rather than re-listed, so a gate added to the state machine cannot be
// left un-resumable here. 'placement' is the odd one out: it is a WORK state that this route also
// treats as a human gate, which is why it needs the re-trigger special case below.
const PROCEED_ALLOWED_STATES: string[] = [...HITL_STATES, 'placement'];

export async function registerProceedRoute(app: FastifyInstance, boss: BossHandle): Promise<void> {
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

    // Enqueue only if the target is real work. Two exclusions, both reachable now that the manual
    // lane chains gates back to back:
    //   · NO_ENQUEUE_STATES (not just HITL) — advanceAndTrigger has always used the wider set, and
    //     a gate whose successor is another gate would otherwise enqueue a step no handler serves.
    //   · TERMINAL_STATES — awaiting_manual_placement advances straight to 'completed'. The
    //     dispatcher's terminal guard would drop that message, but queueing it at all is noise.
    if (!NO_ENQUEUE_STATES.includes(next) && !TERMINAL_STATES.includes(next)) {
      await sendPipelineStep(boss, jobId, next);
    }

    logger.info({ jobId, from: job.current_state, to: next }, 'HITL proceed / trigger');
    return reply.send({ job_id: jobId, previous_state: job.current_state, current_state: next });
  });
}

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { readState } from '../../domain/state-store';
import type { OperatorAuthHook } from './auth';
const ParamsSchema = z.object({ jobId: z.string().uuid() });

export async function registerJobStatusRoute(app: FastifyInstance, authHook: OperatorAuthHook) {
  app.get('/job-status/:jobId', {
    preHandler: authHook
  }, async (req, reply) => {
    const parsed = ParamsSchema.safeParse(req.params);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'Invalid jobId' };
    }
    const { jobId } = parsed.data;
    const state = await readState(jobId);
    if (!state) {
      reply.code(404);
      return { error: 'Job not found' };
    }

    const status = state.flags?.cancelled
      ? 'cancelled'
      : state.flags?.promoteCompleted
        ? 'completed'
        : (state.errors?.length ?? 0) > 0
          ? 'errored'
          : state.pause
            ? state.pause.reason === 'hitl_phase1'
              ? 'awaiting_phase1'
              : 'awaiting_phase2'
            : 'running';

    return {
      jobId,
      status,
      step: state.step ?? null,
      pause: state.pause,
      flags: state.flags ?? null
    };
  });
}

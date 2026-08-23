import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { BossHandle } from '../../queue/boss';
import { config } from '../../config/index';
import { findOrphanedJobs, recoverOrphanedJobs } from '../../orchestration/boot-recovery';
import { createLogger } from '../../utils/logger';

const logger = createLogger({ stage: 'api:recover' });

// Unlike boot, this runs while workers are consuming, so an `active` queue row is far more likely
// to be a step in progress than a corpse. Only rows that have outlived what a step is allowed to
// take may be assumed dead — otherwise the button cancels and re-dispatches live work.
const STALE_ACTIVE_AFTER_SECONDS = config.BOSS_STEP_TIMEOUT_SECONDS + config.BOSS_REAP_GRACE_SECONDS;

// The manual counterpart to boot recovery, for the case boot recovery cannot cover: the service
// stayed up but something else stalled — a job dropped between states, an operator cancelled a
// queue row by hand. Same scan, same rules, on demand.
export async function registerRecoverRoute(app: FastifyInstance, boss: BossHandle): Promise<void> {
  // Dry run: what WOULD be resumed. Safe to poll from a dashboard to show a "N jobs stuck" badge.
  app.get('/jobs/recover', async (_req: FastifyRequest, reply: FastifyReply) => {
    const candidates = await findOrphanedJobs(STALE_ACTIVE_AFTER_SECONDS);
    return reply.send({ count: candidates.length, jobs: candidates });
  });

  app.post('/jobs/recover', async (_req: FastifyRequest, reply: FastifyReply) => {
    const result = await recoverOrphanedJobs(boss, 'resume', STALE_ACTIVE_AFTER_SECONDS);
    logger.info({ resumed: result.resumed, cleared: result.cleared }, 'manual recovery run');
    return reply.send({
      resumed: result.resumed,
      cleared_queue_rows: result.cleared,
      jobs: result.candidates.map((c) => ({ job_id: c.job_id, resumed_at_state: c.current_state })),
    });
  });
}

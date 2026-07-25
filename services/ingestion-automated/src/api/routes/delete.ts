import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getJob } from '../../domain/job-catalog';
import { deleteJobCompletely } from '../../domain/catalog';
import { createLogger } from '../../utils/logger';

const logger = createLogger({ stage: 'api:delete' });

export async function registerDeleteRoute(app: FastifyInstance): Promise<void> {
  app.delete('/jobs/:jobId', async (req: FastifyRequest, reply: FastifyReply) => {
    const { jobId } = req.params as { jobId: string };

    const job = await getJob(jobId).catch(() => null);
    if (!job) return reply.status(404).send({ error: 'Job not found' });

    try {
      await deleteJobCompletely(job);
      logger.info({ jobId }, 'job deleted');
      return reply.send({ job_id: jobId, deleted: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ jobId, err: message }, 'delete failed');
      return reply.status(500).send({ error: 'Delete failed', details: message });
    }
  });
}

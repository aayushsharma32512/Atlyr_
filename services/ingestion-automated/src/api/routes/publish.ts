import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getJob } from '../../domain/job-catalog';
import { publishToProducts } from '../../domain/catalog';
import { createLogger } from '../../utils/logger';

const logger = createLogger({ stage: 'api:publish' });

export async function registerPublishRoute(app: FastifyInstance): Promise<void> {
  app.post('/jobs/:jobId/publish', async (req: FastifyRequest, reply: FastifyReply) => {
    const { jobId } = req.params as { jobId: string };

    const job = await getJob(jobId).catch(() => null);
    if (!job) return reply.status(404).send({ error: 'Job not found' });

    if (job.current_state !== 'completed') {
      return reply.status(409).send({
        error: 'Job is not completed — only completed jobs can be published',
        current_state: job.current_state,
      });
    }

    try {
      const productId = await publishToProducts(job);
      logger.info({ jobId, productId }, 'published to catalog');
      return reply.send({ job_id: jobId, product_id: productId, live: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ jobId, err: message }, 'publish failed');
      return reply.status(500).send({ error: 'Publish failed', details: message });
    }
  });
}

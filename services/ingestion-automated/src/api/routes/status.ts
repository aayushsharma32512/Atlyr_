import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getJob, listJobs } from '../../domain/job-catalog';

export async function registerStatusRoutes(app: FastifyInstance): Promise<void> {
  app.get('/jobs/:jobId', async (req: FastifyRequest, reply: FastifyReply) => {
    const { jobId } = req.params as { jobId: string };

    const job = await getJob(jobId).catch(() => null);
    if (!job) return reply.status(404).send({ error: 'Job not found' });

    return reply.send(job);
  });

  app.get('/jobs', async (req: FastifyRequest, reply: FastifyReply) => {
    const { state, created_by, limit, offset } = req.query as {
      state?: string;
      created_by?: string;
      limit?: string;
      offset?: string;
    };

    const jobs = await listJobs({
      state,
      created_by,
      limit: limit ? Number(limit) : 50,
      offset: offset ? Number(offset) : 0,
    });

    return reply.send({ jobs, count: jobs.length });
  });
}

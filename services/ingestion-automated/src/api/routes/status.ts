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

    // No default ceiling. `limit` omitted means "every matching job" — listJobs pages, so a big
    // queue costs more round trips rather than silently losing the tail. The old default of 50
    // was fine for curl and wrong for the dashboard, which then had to hardcode limit=1000 and
    // inherited PostgREST's truncation anyway.
    const parsedLimit = limit ? Number(limit) : undefined;
    const jobs = await listJobs({
      state,
      created_by,
      limit: Number.isFinite(parsedLimit) && (parsedLimit as number) > 0 ? parsedLimit : undefined,
      offset: offset ? Number(offset) : 0,
    });

    return reply.send({ jobs, count: jobs.length });
  });
}

import type { FastifyInstance } from 'fastify';
import type PgBoss from 'pg-boss';
import { z } from 'zod';
import { buildDedupeKey } from '../../domain/ids';
import { TOPICS } from '../../queue/topics';
import { canonicalizeProductUrl, createJobRecord, findJobByDedupeKey } from '../../domain/job-catalog';

const BodySchema = z.object({ url: z.string().url() });

export async function registerSubmitUrlRoute(app: FastifyInstance, boss: PgBoss) {
  app.post('/submit-url', async (req, reply) => {
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'Invalid body. Expect { url } with a valid URL.' };
    }

    let canonical;
    try {
      canonical = canonicalizeProductUrl(parsed.data.url);
    } catch {
      reply.code(400);
      return { error: 'Unable to parse URL' };
    }

    const dedupeKey = buildDedupeKey(canonical.domain, canonical.path);

    const existing = await findJobByDedupeKey(dedupeKey);
    if (existing) {
      return {
        jobId: existing.job_id,
        dedupeKey,
        status: existing.status,
        duplicate: true
      };
    }

    const created = await createJobRecord(parsed.data.url);

    await boss.send(
      TOPICS.ORCHESTRATOR,
      { jobId: created.jobId },
      { singletonKey: `${TOPICS.ORCHESTRATOR}:${dedupeKey}`, retryLimit: 5, retryBackoff: true }
    );

    return { jobId: created.jobId, dedupeKey };
  });
}

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type PgBoss from 'pg-boss';
import { z } from 'zod';
import { insertJob, findJobByDedupeKey } from '../../domain/job-catalog';
import { computeDedupeKey } from '../../domain/dedup';
import { createLogger } from '../../utils/logger';

const logger = createLogger({ stage: 'api:submit' });

const SubmitBody = z.object({
  product_url:              z.string().url(),
  product_gender_type:      z.enum(['male', 'female', 'unisex']),
  product_type:             z.enum(['topwear', 'bottomwear', 'dress']),
  product_sub_type:         z.string().min(1),
  product_complexity:       z.string().min(1),
  v_ton_model:              z.string().optional(),
  v_ton_image_preference:   z.object({ type: z.string() }).optional(),
  hitl_post_identification: z.boolean().default(false),
  hitl_post_segmentation:   z.boolean().default(false),
  created_by:               z.string().optional(),
});

export async function registerSubmitRoute(app: FastifyInstance, boss: PgBoss): Promise<void> {
  app.post('/jobs', async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = SubmitBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const body = parsed.data;
    const dedupeKey = computeDedupeKey(body.product_url);

    const existing = await findJobByDedupeKey(dedupeKey).catch(() => null);
    if (existing) {
      return reply.status(409).send({
        error: 'A job for this URL is already active',
        job_id: existing.job_id,
        current_state: existing.current_state,
      });
    }

    const job = await insertJob({
      product_url:              body.product_url,
      dedupe_key:               dedupeKey,
      product_gender_type:      body.product_gender_type,
      product_type:             body.product_type,
      product_sub_type:         body.product_sub_type,
      product_complexity:       body.product_complexity,
      v_ton_model:              body.v_ton_model ?? null,
      v_ton_image_preference:   body.v_ton_image_preference ?? null,
      hitl_post_identification: body.hitl_post_identification,
      hitl_post_segmentation:   body.hitl_post_segmentation,
      created_by:               body.created_by ?? null,
    });

    await boss.send('run-pipeline-step', { jobId: job.job_id });

    logger.info({ jobId: job.job_id }, 'job submitted');
    return reply.status(201).send({ job_id: job.job_id, current_state: job.current_state });
  });
}

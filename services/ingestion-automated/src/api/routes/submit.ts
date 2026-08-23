import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { BossHandle } from '../../queue/boss';
import { z } from 'zod';
import { insertJob, findJobByDedupeKey, findLatestJobByDedupeKey } from '../../domain/job-catalog';
import { computeDedupeKey } from '../../domain/dedup';
import { sendPipelineStep } from '../../queue/send-step';
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
  // Economy mode. Defaults to 'instant' so an unaware caller can never route work into a batch:
  // opting in is always explicit, per row.
  vton_lane:                z.enum(['instant', 'batch']).default('instant'),
  created_by:               z.string().optional(),
});

export async function registerSubmitRoute(app: FastifyInstance, boss: BossHandle): Promise<void> {
  app.post('/jobs', async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = SubmitBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const body = parsed.data;
    const dedupeKey = computeDedupeKey(body.product_url);

    const active = await findJobByDedupeKey(dedupeKey).catch(() => null);
    if (active) {
      return reply.status(409).send({
        error: 'already_active',
        message: 'A job for this URL is already active',
        existing_job_id: active.job_id,
        current_state: active.current_state,
      });
    }

    // No active job, but the URL may have been ingested before (a completed job). Block and link
    // the caller to the original so the dashboard can highlight it.
    const previous = await findLatestJobByDedupeKey(dedupeKey).catch(() => null);
    if (previous && previous.current_state === 'completed') {
      return reply.status(409).send({
        error: 'already_ingested',
        message: 'This product has already been ingested',
        existing_job_id: previous.job_id,
        product_id: previous.ingested_product_id,
        current_state: previous.current_state,
      });
    }

    // A failed/discarded/cancelled job still holds this URL's UNIQUE dedupe_key. Without this
    // branch the insert below hits the constraint and returns a 500 with a raw Postgres error —
    // meaning any URL that has ever failed can never be submitted again, only restarted. Say so.
    if (previous) {
      return reply.status(409).send({
        error: 'previous_attempt_exists',
        message: `A previous job for this URL ended in '${previous.current_state}'. Restart that job instead of resubmitting.`,
        existing_job_id: previous.job_id,
        current_state: previous.current_state,
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
      vton_lane:                body.vton_lane,
      created_by:               body.created_by ?? null,
    });

    await sendPipelineStep(boss, job.job_id);

    logger.info({ jobId: job.job_id }, 'job submitted');
    return reply.status(201).send({ job_id: job.job_id, current_state: job.current_state });
  });
}

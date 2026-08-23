import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { BossHandle } from '../../queue/boss';
import { z } from 'zod';
import { insertJob, findJobByDedupeKey, findLatestJobByDedupeKey } from '../../domain/job-catalog';
import { insertBatch, updateBatchTotal, getBatch, listBatches, listJobsByBatch } from '../../domain/batch-catalog';
import { computeDedupeKey } from '../../domain/dedup';
import { sendPipelineStep } from '../../queue/send-step';
import { createLogger } from '../../utils/logger';

const logger = createLogger({ stage: 'api:batches' });

// Server-side bulk ingestion. Replaces the browser-side pacing loop (useBulkIngest submitted 3
// jobs at a time and died with the tab): the whole sheet is accepted in one request, every job
// is created and enqueued immediately, and pg-boss teamSize is the only thing that governs how
// many run at once. The dashboard polls GET /batches/:batchId for rollup progress.

const MAX_BATCH_SIZE = 500;

const BatchRow = z.object({
  product_url:         z.string().url(),
  product_gender_type: z.enum(['male', 'female', 'unisex']),
  product_type:        z.enum(['topwear', 'bottomwear', 'dress']),
  product_sub_type:    z.string().min(1),
});

const BatchBody = z.object({
  label:      z.string().min(1),
  created_by: z.string().optional(),
  rows:       z.array(BatchRow).min(1).max(MAX_BATCH_SIZE),
  // Applied to every job in the batch — same knobs the single-submit route takes per job.
  options: z.object({
    product_complexity:       z.string().min(1).default('complex'),
    v_ton_model:              z.string().optional(),
    hitl_post_identification: z.boolean().default(false),
    hitl_post_segmentation:   z.boolean().default(true),
  }).default({}),
});

type BatchRowInput = z.infer<typeof BatchRow>;

type RowOutcome =
  | { url: string; status: 'submitted'; job_id: string }
  | { url: string; status: 'duplicate'; kind: 'already_active' | 'already_ingested' | 'in_batch'; existing_job_id: string | null }
  | { url: string; status: 'rejected'; error: string };

// Bounded-concurrency map. Each row costs two dedupe selects, an insert, and a queue send;
// sequential over 500 rows would hold the HTTP request open for minutes, unbounded would
// stampede Postgres. Replace with the shared limiter when the Phase-2 governor lands.
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(lanes);
  return results;
}

export async function registerBatchRoutes(app: FastifyInstance, boss: BossHandle): Promise<void> {
  app.post('/batches', async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = BatchBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request', details: parsed.error.flatten() });
    }
    const body = parsed.data;

    // In-request dedupe: the sheet parser already drops repeats client-side, but the server
    // can't rely on that — two rows with the same URL would race the DB dedupe check below.
    const seen = new Set<string>();
    const rows: BatchRowInput[] = [];
    const outcomes: RowOutcome[] = [];
    for (const row of body.rows) {
      const key = computeDedupeKey(row.product_url);
      if (seen.has(key)) {
        outcomes.push({ url: row.product_url, status: 'duplicate', kind: 'in_batch', existing_job_id: null });
        continue;
      }
      seen.add(key);
      rows.push(row);
    }

    const batch = await insertBatch({
      label: body.label,
      created_by: body.created_by ?? null,
      total: 0,
    });

    const submitOne = async (row: BatchRowInput): Promise<RowOutcome> => {
      const dedupeKey = computeDedupeKey(row.product_url);
      try {
        const active = await findJobByDedupeKey(dedupeKey).catch(() => null);
        if (active) {
          return { url: row.product_url, status: 'duplicate', kind: 'already_active', existing_job_id: active.job_id };
        }
        const previous = await findLatestJobByDedupeKey(dedupeKey).catch(() => null);
        if (previous && previous.current_state === 'completed') {
          return { url: row.product_url, status: 'duplicate', kind: 'already_ingested', existing_job_id: previous.job_id };
        }

        const job = await insertJob({
          product_url:              row.product_url,
          dedupe_key:               dedupeKey,
          product_gender_type:      row.product_gender_type,
          product_type:             row.product_type,
          product_sub_type:         row.product_sub_type,
          product_complexity:       body.options.product_complexity,
          v_ton_model:              body.options.v_ton_model ?? null,
          v_ton_image_preference:   null,
          hitl_post_identification: body.options.hitl_post_identification,
          hitl_post_segmentation:   body.options.hitl_post_segmentation,
          created_by:               body.created_by ?? null,
          batch_id:                 batch.batch_id,
        });

        await sendPipelineStep(boss, job.job_id);
        return { url: row.product_url, status: 'submitted', job_id: job.job_id };
      } catch (err) {
        return { url: row.product_url, status: 'rejected', error: (err as Error).message };
      }
    };

    outcomes.push(...await mapLimit(rows, 8, submitOne));

    const submitted = outcomes.filter(o => o.status === 'submitted').length;
    await updateBatchTotal(batch.batch_id, submitted).catch(err =>
      logger.error({ batchId: batch.batch_id, error: (err as Error).message }, 'failed to write batch total'),
    );

    const duplicates = outcomes.filter(o => o.status === 'duplicate').length;
    const rejected = outcomes.filter(o => o.status === 'rejected').length;
    logger.info(
      { batchId: batch.batch_id, label: body.label, submitted, duplicates, rejected },
      'batch submitted',
    );

    return reply.status(201).send({
      batch_id: batch.batch_id,
      label: batch.label,
      submitted,
      duplicates,
      rejected,
      outcomes,
    });
  });

  app.get('/batches', async (req: FastifyRequest, reply: FastifyReply) => {
    const { limit } = req.query as { limit?: string };
    const batches = await listBatches(limit ? Number(limit) : 20);
    return reply.send({ batches, count: batches.length });
  });

  app.get('/batches/:batchId', async (req: FastifyRequest, reply: FastifyReply) => {
    const { batchId } = req.params as { batchId: string };

    const batch = await getBatch(batchId).catch(() => null);
    if (!batch) return reply.status(404).send({ error: 'Batch not found' });

    const jobs = await listJobsByBatch(batchId);

    const by = (states: string[]) => jobs.filter(j => states.includes(j.current_state)).length;
    const completed = by(['completed']);
    const hitl = by(['awaiting_hitl_identification', 'awaiting_hitl_segmentation']);
    const failed = by(['failed', 'discarded', 'cancelled']);

    return reply.send({
      batch,
      counts: {
        total: jobs.length,
        completed,
        hitl,
        failed,
        running: jobs.length - completed - hitl - failed,
      },
      // Slim rows: enough for the poll UI and the client-side retry sweep without dragging the
      // full job payload (or the dashboard's 1000-job list call) into every poll tick.
      jobs: jobs.map(j => ({
        job_id: j.job_id,
        product_url: j.product_url,
        current_state: j.current_state,
        error_count: j.error_count,
        last_error_step: j.last_error_step,
        updated_at: j.updated_at,
      })),
    });
  });
}

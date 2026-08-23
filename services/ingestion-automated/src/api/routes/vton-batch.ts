/**
 * Operator controls for the economy VTON lane.
 *
 * These exist because the kill switch alone is not a recovery story: `VTON_BATCH_ENABLED=false`
 * stops new submissions, but whatever is already parked stays parked, and clicking "restart" per
 * job does not scale to a 500-row sheet.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { BossHandle } from '../../queue/boss';
import { z } from 'zod';
import { config } from '../../config/index';
import {
  listOpenBatches,
  unparkAllUnclaimed,
  countUnclaimedParked,
  releaseClaims,
  updateBatchStatus,
} from '../../domain/gemini-batches';
import { cancelBatch } from '../../adapters/gemini-batch';
import { errorMessageOf } from '../../adapters/gemini-batch.protocol';
import { sendPipelineStep } from '../../queue/send-step';
import { createLogger } from '../../utils/logger';

const logger = createLogger({ stage: 'api:vton-batch' });

const CancelBody = z.object({
  /** Also hand the tray's members back to the instant lane instead of waiting for the sweep. */
  unpark: z.boolean().default(true),
});

export async function registerVtonBatchRoutes(app: FastifyInstance, boss: BossHandle): Promise<void> {
  // What the lane is doing right now — enough to answer "is it stuck?" without opening the DB.
  app.get('/vton-batches', async () => {
    const [open, waiting] = await Promise.all([listOpenBatches(), countUnclaimedParked()]);
    const now = Date.now();
    return {
      enabled: config.VTON_BATCH_ENABLED,
      model: config.VTON_BATCH_MODEL,
      flush_size: config.VTON_BATCH_FLUSH_SIZE,
      parked_unclaimed: waiting,
      batches: open.map((b) => {
        const since = b.submitted_at ?? b.created_at;
        const ageSeconds = Math.round((now - Date.parse(since)) / 1000);
        return {
          batch_id: b.batch_id,
          provider_batch_name: b.provider_batch_name,
          status: b.status,
          request_count: b.request_count,
          fallback_count: b.fallback_count,
          age_seconds: ageSeconds,
          // The badge the dashboard shows when a tray has outlived its expected turnaround.
          stale: ageSeconds > config.VTON_BATCH_STALE_WARN_SECONDS,
        };
      }),
    };
  });

  /**
   * Bulk unpark: every parked job not yet claimed by a tray goes back to the instant lane and is
   * enqueued. Claimed jobs are deliberately left alone — they are already paid for and the poller
   * will resolve them.
   */
  app.post('/vton-batches/unpark', async (_req: FastifyRequest, reply: FastifyReply) => {
    const jobIds = await unparkAllUnclaimed();
    for (const jobId of jobIds) {
      await sendPipelineStep(boss, jobId, 'generating_vton');
    }
    logger.warn({ count: jobIds.length }, 'bulk unparked jobs into the instant lane');
    return reply.send({ unparked: jobIds.length, job_ids: jobIds });
  });

  /**
   * Cancel a tray that should not have been submitted, so it stops billing. Best-effort at the
   * provider — a tray that already finished cannot be cancelled — but the local claim release is
   * unconditional, so the jobs never stay stuck behind a cancel that failed upstream.
   */
  app.post('/vton-batches/:batchId/cancel', async (req: FastifyRequest, reply: FastifyReply) => {
    const { batchId } = req.params as { batchId: string };
    const parsed = CancelBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const batch = (await listOpenBatches()).find((b) => b.batch_id === batchId);
    if (!batch) return reply.status(404).send({ error: 'No open batch with that id' });

    let providerError: string | null = null;
    if (batch.provider_batch_name) {
      try {
        await cancelBatch(batch.provider_batch_name);
      } catch (err) {
        providerError = errorMessageOf(err);
        logger.warn({ batchId, error: providerError }, 'provider cancel failed, releasing locally anyway');
      }
    }

    let released = 0;
    if (parsed.data.unpark) {
      released = await releaseClaims(batch.batch_id);
    }
    await updateBatchStatus(batch.batch_id, 'failed', {
      error: `cancelled by operator${providerError ? ` (provider cancel failed: ${providerError})` : ''}`,
      completed: true,
    });

    logger.warn({ batchId, released }, 'batch cancelled by operator');
    return reply.send({ batch_id: batchId, released, provider_cancel_error: providerError });
  });
}

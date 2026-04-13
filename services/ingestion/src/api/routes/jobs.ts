import type { FastifyInstance } from 'fastify';
import type PgBoss from 'pg-boss';
import { z } from 'zod';
import { TOPICS } from '../../queue/topics';
import { canonicalizeProductUrl, createJobRecord, findJobByDedupeKey, getJobWithState, updateJobCatalogFromState } from '../../domain/job-catalog';
import { buildDedupeKey, uuid } from '../../domain/ids';
import { supabaseAdmin } from '../../db/supabase';
import { config } from '../../config/index';
import { persistStatePatch, readState, resetState } from '../../domain/state-store';
import { createLogger } from '../../utils/logger';
import type { OperatorAuthHook } from './auth';

const MAX_BATCH_SIZE = 200;
const DEFAULT_LIMIT = 25;

const BatchSubmitBody = z.object({
  urls: z.array(z.string().trim()).min(1),
  label: z.string().max(120).optional()
});

const JobsQuerySchema = z.object({
  status: z.string().optional(),
  search: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
  cursor: z.string().optional()
});

const CursorSchema = z.object({
  createdAt: z.string(),
  jobId: z.string().uuid()
});

const JobIdParamsSchema = z.object({
  jobId: z.string().uuid()
});

type BatchResultItem =
  | { url: string; status: 'invalid'; reason: string }
  | { url: string; status: 'duplicate'; jobId: string; dedupeKey: string; existingStatus: string }
  | { url: string; status: 'enqueued'; jobId: string; dedupeKey: string };

function encodeCursor(cursor: { createdAt: string; jobId: string }): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(raw: string | undefined) {
  if (!raw) return null;
  try {
    const decoded = Buffer.from(raw, 'base64url').toString('utf8');
    return CursorSchema.parse(JSON.parse(decoded));
  } catch {
    return null;
  }
}

type StorageListEntry = {
  name: string;
  id?: string | null;
  metadata?: unknown;
};

async function collectStorageFiles(root: string): Promise<string[]> {
  const bucket = supabaseAdmin.storage.from(config.STORAGE_BUCKET);
  const results: string[] = [];
  const queue: string[] = [root];

  while (queue.length > 0) {
    const prefix = queue.pop()!;
    const { data, error } = await bucket.list(prefix, { limit: 1000 });
    if (error) {
      continue;
    }
    const entries = (data ?? []) as StorageListEntry[];
    for (const entry of entries) {
      const isFolder = !entry.id;
      const childPath = `${prefix}/${entry.name}`;
      if (isFolder) {
        queue.push(childPath);
      } else {
        results.push(childPath);
      }
    }
  }

  return results;
}

async function removeStorageFiles(paths: string[]) {
  if (paths.length === 0) return;
  const bucket = supabaseAdmin.storage.from(config.STORAGE_BUCKET);
  const chunkSize = 100;
  for (let i = 0; i < paths.length; i += chunkSize) {
    const chunk = paths.slice(i, i + chunkSize);
    await bucket.remove(chunk);
  }
}

export async function registerJobRoutes(
  app: FastifyInstance,
  boss: PgBoss,
  authHook: OperatorAuthHook
) {
  const logger = createLogger({ stage: 'jobs-route' });

  app.post('/jobs/batch-submit', { preHandler: authHook }, async (req, reply) => {
    const parsed = BatchSubmitBody.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'Invalid payload' };
    }

    const rawUrls = parsed.data.urls
      .flatMap((entry) => entry.split(/[,\n]/))
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

    if (rawUrls.length === 0) {
      reply.code(400);
      return { error: 'Provide at least one URL' };
    }

    const truncated = rawUrls.slice(0, MAX_BATCH_SIZE);
    const removedCount = rawUrls.length - truncated.length;
    const dedupeMap = new Map<string, { jobId: string; status: string }>();
    const results: BatchResultItem[] = [];
    const batchId = uuid();

    for (const url of truncated) {
      let canonical;
      try {
        canonical = canonicalizeProductUrl(url);
      } catch (error) {
        results.push({ url, status: 'invalid', reason: 'Invalid URL' });
        continue;
      }

      const dedupeKey = buildDedupeKey(canonical.domain, canonical.path);
      const existingBatch = dedupeMap.get(dedupeKey);
      if (existingBatch) {
        results.push({
          url,
          status: 'duplicate',
          jobId: existingBatch.jobId,
          dedupeKey,
          existingStatus: existingBatch.status
        });
        continue;
      }

      const existingJob = await findJobByDedupeKey(dedupeKey);
      if (existingJob) {
        dedupeMap.set(dedupeKey, { jobId: existingJob.job_id, status: existingJob.status });
        results.push({
          url,
          status: 'duplicate',
          jobId: existingJob.job_id,
          dedupeKey,
          existingStatus: existingJob.status
        });
        continue;
      }

      try {
        const created = await createJobRecord(url, { batchId, batchLabel: parsed.data.label });
        await boss.send(
          TOPICS.ORCHESTRATOR,
          { jobId: created.jobId },
          { singletonKey: `${TOPICS.ORCHESTRATOR}:${created.dedupeKey}`, retryLimit: 5, retryBackoff: true }
        );
        dedupeMap.set(dedupeKey, { jobId: created.jobId, status: 'queued' });
        results.push({
          url,
          status: 'enqueued',
          jobId: created.jobId,
          dedupeKey
        });
      } catch (error) {
        results.push({
          url,
          status: 'invalid',
          reason: error instanceof Error ? error.message : 'Failed to create job'
        });
      }
    }

    const summary = results.reduce(
      (acc, item) => {
        acc[item.status] = (acc[item.status] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    return {
      batchId,
      summary,
      truncated: removedCount > 0 ? removedCount : 0,
      items: results
    };
  });

  app.get('/jobs', { preHandler: authHook }, async (req, reply) => {
    const parsed = JobsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'Invalid query' };
    }

    const { status, search } = parsed.data;
    const limit = parsed.data.limit ?? DEFAULT_LIMIT;
    const cursor = decodeCursor(parsed.data.cursor);

    let query = supabaseAdmin
      .from('ingestion_jobs')
      .select('*')
      .order('created_at', { ascending: false })
      .order('job_id', { ascending: false })
      .limit(limit + 1);

    if (status) {
      query = query.eq('status', status);
    }

    if (search) {
      const term = `%${search}%`;
      const encoded = encodeURIComponent(term);
      query = query.or(
        `original_url.ilike.${encoded},canonical_url.ilike.${encoded},job_id.ilike.${encoded},dedupe_key.ilike.${encoded}`
      );
    }

    if (cursor) {
      const createdAtEncoded = encodeURIComponent(cursor.createdAt);
      const jobIdEncoded = encodeURIComponent(cursor.jobId);
      query = query.or(
        `created_at.lt.${createdAtEncoded},and(created_at.eq.${createdAtEncoded},job_id.lt.${jobIdEncoded})`
      );
    }

    const { data, error } = await query;
    if (error) {
      req.log.error({ error }, 'Failed to list jobs');
      reply.code(500);
      return { error: 'Failed to fetch jobs' };
    }

    const hasMore = (data?.length ?? 0) > limit;
    const items = hasMore ? data!.slice(0, limit) : data ?? [];

    const nextCursor =
      hasMore && items.length > 0
        ? encodeCursor({
            createdAt: items[items.length - 1].created_at,
            jobId: items[items.length - 1].job_id
          })
        : null;

    return {
      items,
      nextCursor
    };
  });

  app.post('/jobs/:jobId/cancel', { preHandler: authHook }, async (req, reply) => {
    const parsed = JobIdParamsSchema.safeParse(req.params);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'Invalid jobId' };
    }

    const { jobId } = parsed.data;
    const state = await readState(jobId);
    if (!state) {
      reply.code(404);
      return { error: 'Job not found' };
    }

    const cancelledAt = new Date().toISOString();
    const next = await persistStatePatch(jobId, {
      jobId,
      pause: null,
      step: 'cancelled',
      flags: { cancelled: true },
      timestamps: { job_cancelled_at: cancelledAt }
    });
    await updateJobCatalogFromState(jobId, next);

    return { jobId, cancelled: true };
  });

  app.post('/jobs/:jobId/requeue', { preHandler: authHook }, async (req, reply) => {
    const parsed = JobIdParamsSchema.safeParse(req.params);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'Invalid jobId' };
    }

    const { jobId } = parsed.data;
    const { data: catalog, error: catalogError } = await supabaseAdmin
      .from('ingestion_jobs')
      .select('job_id,status,dedupe_key,started_at')
      .eq('job_id', jobId)
      .maybeSingle();
    if (catalogError) {
      reply.code(500);
      return { error: 'Failed to load job metadata' };
    }
    if (!catalog) {
      reply.code(404);
      return { error: 'Job not found' };
    }

    const state = await readState(jobId);
    if (!state) {
      reply.code(404);
      return { error: 'Job state not found' };
    }

    const status = (catalog as { status?: string }).status ?? 'queued';
    if (status === 'completed' || status === 'cancelled') {
      reply.code(409);
      return { error: 'Job is completed or cancelled' };
    }
    if (state.pause?.reason) {
      reply.code(409);
      return { error: 'Job is awaiting human input' };
    }

    const dedupeKey = (catalog as { dedupe_key?: string | null }).dedupe_key ?? null;
    const singletonKey = dedupeKey
      ? `${TOPICS.ORCHESTRATOR}:${dedupeKey}`
      : `${TOPICS.ORCHESTRATOR}:${jobId}`;
    await boss.send(
      TOPICS.ORCHESTRATOR,
      { jobId },
      { singletonKey, retryLimit: 5, retryBackoff: true }
    );

    const now = new Date().toISOString();
    const { error: updateError } = await supabaseAdmin
      .from('ingestion_jobs')
      .update({ status: 'queued', queued_at: now, updated_at: now })
      .eq('job_id', jobId);
    if (updateError) {
      logger.warn({ jobId, error: updateError.message }, 'Failed to update job metadata after requeue');
    }

    return { jobId, requeued: true };
  });

  app.delete('/jobs/:jobId', { preHandler: authHook }, async (req, reply) => {
    const parsed = JobIdParamsSchema.safeParse(req.params);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'Invalid jobId' };
    }

    const { jobId } = parsed.data;
    const { data: catalog, error: catalogError } = await supabaseAdmin
      .from('ingestion_jobs')
      .select('job_id,status,dedupe_key')
      .eq('job_id', jobId)
      .maybeSingle();
    if (catalogError) {
      reply.code(500);
      return { error: 'Failed to load job metadata' };
    }
    if (!catalog) {
      reply.code(404);
      return { error: 'Job not found' };
    }

    const status = (catalog as { status?: string }).status ?? 'queued';
    const allowDelete = status === 'cancelled' || status === 'completed' || status === 'errored';
    if (!allowDelete) {
      reply.code(409);
      return { error: 'Cancel the job before deleting' };
    }

    const productId = (catalog as { dedupe_key?: string }).dedupe_key ?? null;

    try {
      const storageRoots = [
        `${config.RAW_PREFIX}/${jobId}`,
        `artifacts/pages/${jobId}`,
        `${config.GHOST_PREFIX}/${jobId}`,
        `${config.STAGING_GM_PREFIX}/${jobId}`,
        `${config.PROCESSED_GM_PREFIX}/${jobId}`,
        `${config.PROCESSED_PRODUCT_PREFIX}/${jobId}`,
      ];

      const files = (await Promise.all(storageRoots.map((root) => collectStorageFiles(root)))).flat();
      await removeStorageFiles(files);
    } catch (error) {
      logger.warn({ jobId, error: error instanceof Error ? error.message : String(error) }, 'Storage cleanup failed (continuing)');
    }

    if (productId) {
      const [{ error: ingestedDeleteError }, { error: productDeleteError }] = await Promise.all([
        supabaseAdmin.from('ingested_products').delete().eq('id', productId),
        supabaseAdmin.from('products').delete().eq('id', productId),
      ]);
      if (ingestedDeleteError) {
        reply.code(500);
        return { error: `Failed to delete ingested product: ${ingestedDeleteError.message}` };
      }
      if (productDeleteError) {
        reply.code(500);
        return { error: `Failed to delete product: ${productDeleteError.message}` };
      }
    }

    await resetState(jobId);

    const { error: jobDeleteError } = await supabaseAdmin
      .from('ingestion_jobs')
      .delete()
      .eq('job_id', jobId);
    if (jobDeleteError) {
      reply.code(500);
      return { error: `Failed to delete job: ${jobDeleteError.message}` };
    }

    return { deleted: true };
  });

  app.get('/jobs/:jobId/details', { preHandler: authHook }, async (req, reply) => {
    const params = z.object({ jobId: z.string().uuid() }).safeParse(req.params);
    if (!params.success) {
      reply.code(400);
      return { error: 'Invalid jobId' };
    }

    const { catalog, state } = await getJobWithState(params.data.jobId);
    if (!catalog && !state) {
      reply.code(404);
      return { error: 'Job not found' };
    }

    return {
      job: catalog,
      state
    };
  });
}

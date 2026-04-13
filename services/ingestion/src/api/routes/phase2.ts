import { Buffer } from 'node:buffer';
import type { FastifyInstance } from 'fastify';
import type PgBoss from 'pg-boss';
import { z } from 'zod';
import { Phase2UpdatePayload } from '../../domain/contracts';
import { readState } from '../../domain/state-store';
import { rerunNode, approvePhaseTwo, ResumeError } from '../../orchestration/resume';
import { createLogger } from '../../utils/logger';
import type { PipelineState } from '../../domain/state';
import { uploadGhostProcessedImage } from '../../adapters/storage/supabase-storage';
import { persistStatePatchAndSync } from '../../orchestration/state-sync';

const ParamsSchema = z.object({ jobId: z.string().uuid() });
const GhostUploadPayload = z.object({
  view: z.enum(['front', 'back']),
  filename: z.string().min(1),
  contentType: z.string().min(1),
  data: z.string().min(1)
});

const logger = createLogger({ stage: 'phase2-route' });

export async function registerPhase2Routes(app: FastifyInstance, boss: PgBoss, authHook: (request: any, reply: any, done: (err?: Error) => void) => void) {
  app.post('/jobs/:jobId/phase2/uploads', {
    preHandler: authHook,
    bodyLimit: 30 * 1024 * 1024
  }, async (req, reply) => {
    const params = ParamsSchema.safeParse(req.params);
    if (!params.success) {
      reply.code(400);
      return { error: 'Invalid jobId' };
    }
    const body = GhostUploadPayload.safeParse(req.body);
    if (!body.success) {
      reply.code(400);
      return { error: 'Invalid payload' };
    }

    const { jobId } = params.data;
    const { view, filename, contentType, data } = body.data;

    try {
      const buffer = Buffer.from(data, 'base64');
      const storagePath = await uploadGhostProcessedImage({
        jobId,
        view,
        filename,
        buffer,
        contentType
      });
      const processedPatch: Partial<PipelineState> = {
        processed: {
          productImages: {
            [view]: storagePath,
          },
        },
      };
      await persistStatePatchAndSync(jobId, processedPatch, 'hitl_phase2_pause');

      return { storagePath };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Upload failed';
      logger.error({ jobId, view, message }, 'Processed ghost upload failed');
      reply.code(500);
      return { error: message };
    }
  });

  app.post('/jobs/:jobId/phase2', {
    preHandler: authHook
  }, async (req, reply) => {
    const params = ParamsSchema.safeParse(req.params);
    if (!params.success) {
      reply.code(400);
      return { error: 'Invalid jobId' };
    }
    const body = Phase2UpdatePayload.safeParse(req.body);
    if (!body.success) {
      reply.code(400);
      return { error: 'Invalid payload' };
    }

    const { jobId } = params.data;
    const { patch, action, node, data } = body.data;

    const resolveProcessedUploads = () => {
      const patchRecord = patch as Record<string, unknown> | undefined;
      const artifacts = patchRecord?.artifacts;
      if (!artifacts || typeof artifacts !== 'object') return undefined;
      const processed = artifacts as Record<string, unknown>;
      const uploads = processed.processedUploads;
      if (!uploads || typeof uploads !== 'object') return undefined;
      const entries = Object.entries(uploads as Record<string, unknown>);
      if (!entries.length) return undefined;
      return Object.fromEntries(
        entries
          .map(([key, value]) => {
            if (typeof value !== 'object' || value === null) return null;
            const record = value as Record<string, unknown>;
            const path = typeof record.storagePath === 'string' ? record.storagePath : undefined;
            if (!path) return null;
            return [key, path];
          })
          .filter((entry): entry is [string, string] => Array.isArray(entry))
      );
    };

    const processedUploads = resolveProcessedUploads();

    if (patch) {
      const patchPayload: Record<string, unknown> = { jobId, ...patch };
      if (processedUploads && Object.keys(processedUploads).length > 0) {
        const existingProcessed = (patchPayload['processed'] as Record<string, unknown> | undefined) ?? {};
        patchPayload['processed'] = {
          ...existingProcessed,
          productImages: processedUploads,
        };
      }
      await persistStatePatchAndSync(jobId, patchPayload, 'hitl_phase2_pause');
    }

    try {
      if (action === 'regenerate') {
        if (!node) {
          reply.code(400);
          return { error: 'Missing node for regeneration' };
        }
        const state = await rerunNode(boss, jobId, node, data);
        return { jobId, action, state };
      }

      if (action === 'approve') {
        const state = await approvePhaseTwo(boss, jobId, data);
        return { jobId, action: 'approve', state };
      }

      return { jobId, action: 'save' };
    } catch (err) {
      if (err instanceof ResumeError) {
        reply.code(400);
        return { error: err.message };
      }
      throw err;
    }
  });

  app.get('/jobs/:jobId/state', {
    preHandler: authHook
  }, async (req, reply) => {
    const params = ParamsSchema.safeParse(req.params);
    if (!params.success) {
      reply.code(400);
      return { error: 'Invalid jobId' };
    }
    const { jobId } = params.data;
    const state = await readState(jobId);
    if (!state) {
      reply.code(404);
      return { error: 'Job not found' };
    }
    return state;
  });
}

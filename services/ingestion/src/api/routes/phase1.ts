import { Buffer } from 'node:buffer';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type PgBoss from 'pg-boss';
import { z } from 'zod';
import sharp from 'sharp';
import { config } from '../../config/index';
import {
  DownloadedImageMeta,
  ExtractDraftImage,
  Phase1UpdatePayload,
  type DownloadedImageMetaT,
  type ExtractDraftImageT,
} from '../../domain/contracts';
import { readState } from '../../domain/state-store';
import { resumeConversation, ResumeError } from '../../orchestration/resume';
import { createLogger } from '../../utils/logger';
import type { PauseResumeSignal } from '../../domain/state';
import type { PipelineState } from '../../domain/state';
import { supabaseAdmin } from '../../db/supabase';
import { uploadRawImage } from '../../adapters/storage/supabase-storage';
import type { OperatorAuthHook } from './auth';
import { persistStatePatchAndSync } from '../../orchestration/state-sync';

const ParamsSchema = z.object({ jobId: z.string().uuid() });
const Phase1UploadPayload = z.object({
  filename: z.string().min(1),
  contentType: z.string().min(1),
  data: z.string().min(1),
});
const Phase1ImageDeletePayload = z.object({
  url: z.string().min(1),
});

const logger = createLogger({ stage: 'phase1-route' });

async function inferDimensions(buffer: Buffer): Promise<{ width?: number; height?: number }> {
  try {
    const metadata = await sharp(buffer).metadata();
    return { width: metadata.width, height: metadata.height };
  } catch {
    return {};
  }
}

function coerceDownloadedImageMeta(entry: unknown): DownloadedImageMetaT | null {
  if (!entry || typeof entry !== 'object') return null;
  const record = entry as Record<string, unknown>;

  const originalUrl =
    typeof record.originalUrl === 'string'
      ? record.originalUrl
      : typeof record.original_url === 'string'
        ? record.original_url
        : null;
  const storagePath =
    typeof record.storagePath === 'string'
      ? record.storagePath
      : typeof record.storage_path === 'string'
        ? record.storage_path
        : null;
  const hash = typeof record.hash === 'string' ? record.hash : null;
  const sizeBytes =
    typeof record.sizeBytes === 'number'
      ? record.sizeBytes
      : typeof record.size_bytes === 'number'
        ? record.size_bytes
        : null;
  const contentType =
    typeof record.contentType === 'string'
      ? record.contentType
      : typeof record.content_type === 'string'
        ? record.content_type
        : null;
  const sortOrder =
    typeof record.sortOrder === 'number'
      ? record.sortOrder
      : typeof record.sort_order === 'number'
        ? record.sort_order
        : null;
  const isPrimarySuggestion =
    typeof record.isPrimarySuggestion === 'boolean'
      ? record.isPrimarySuggestion
      : typeof record.is_primary_suggestion === 'boolean'
        ? record.is_primary_suggestion
        : typeof record.is_primary === 'boolean'
          ? record.is_primary
          : null;
  const productId =
    typeof record.productId === 'string'
      ? record.productId
      : typeof record.product_id === 'string'
        ? record.product_id
        : null;
  const downloadedAt =
    typeof record.downloadedAt === 'string'
      ? record.downloadedAt
      : typeof record.downloaded_at === 'string'
        ? record.downloaded_at
        : null;

  if (
    !originalUrl ||
    !storagePath ||
    !hash ||
    typeof sizeBytes !== 'number' ||
    !contentType ||
    typeof sortOrder !== 'number' ||
    typeof isPrimarySuggestion !== 'boolean' ||
    !productId ||
    !downloadedAt
  ) {
    return null;
  }

  const normalized: Record<string, unknown> = {
    originalUrl,
    storagePath,
    hash,
    sizeBytes,
    contentType,
    sortOrder,
    isPrimarySuggestion,
    productId,
    downloadedAt,
  };

  if (typeof record.width === 'number') normalized.width = record.width;
  if (typeof record.height === 'number') normalized.height = record.height;
  if (typeof record.kindHint === 'string' || record.kindHint === null) normalized.kindHint = record.kindHint;
  if (typeof record.genderHint === 'string' || record.genderHint === null) normalized.genderHint = record.genderHint;
  if (typeof record.vtoEligibleHint === 'boolean') normalized.vtoEligibleHint = record.vtoEligibleHint;
  if (typeof record.productView === 'string' || record.productView === null) normalized.productView = record.productView;
  if (typeof record.ghostEligible === 'boolean') normalized.ghostEligible = record.ghostEligible;
  if (typeof record.summaryEligible === 'boolean') normalized.summaryEligible = record.summaryEligible;
  if (typeof record.filename === 'string') normalized.filename = record.filename;

  const parsed = DownloadedImageMeta.safeParse(normalized);
  return parsed.success ? parsed.data : null;
}

const ImageClassification = z.object({
  hash: z.string(),
  storagePath: z.string(),
  kind: z.enum(['flatlay', 'model', 'detail']),
  confidence: z.number(),
  classifierVersion: z.string().optional(),
});
type ImageClassificationT = z.infer<typeof ImageClassification>;

function resolvePublicUrl(path: string): string {
  const { data } = supabaseAdmin.storage.from(config.STORAGE_BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) {
    throw new Error(`unable-to-resolve-public-url:${path}`);
  }
  return data.publicUrl;
}

export async function registerPhase1Routes(app: FastifyInstance, boss: PgBoss, authHook: OperatorAuthHook) {
  app.post('/jobs/:jobId/phase1/uploads', {
    preHandler: authHook,
    bodyLimit: 30 * 1024 * 1024
  }, async (req, reply) => {
    const params = ParamsSchema.safeParse(req.params);
    if (!params.success) {
      reply.code(400);
      return { error: 'Invalid jobId' };
    }
    const body = Phase1UploadPayload.safeParse(req.body);
    if (!body.success) {
      reply.code(400);
      return { error: 'Invalid payload' };
    }

    const { jobId } = params.data;
    const { filename, contentType, data } = body.data;

    try {
      const buffer = Buffer.from(data, 'base64');
      const hash = crypto.createHash('sha256').update(Uint8Array.from(buffer)).digest('hex');
      const dimensions = await inferDimensions(buffer);
      const storagePath = await uploadRawImage(jobId, hash, buffer, contentType);
      const url = resolvePublicUrl(storagePath);

      const current = await readState(jobId);
      if (!current) {
        reply.code(404);
        return { error: 'Job not found' };
      }

      const existingDraftImages = Array.isArray(current.draft?.images) ? (current.draft?.images as Array<Record<string, unknown>>) : [];
      const existingRawImages: DownloadedImageMetaT[] = (Array.isArray(current.artifacts?.rawImages) ? current.artifacts!.rawImages! : [])
        .map(coerceDownloadedImageMeta)
        .filter((entry): entry is DownloadedImageMetaT => Boolean(entry));

      const nextSortOrder = existingDraftImages.reduce((max, entry) => {
        const value = typeof entry.sort_order === 'number' ? entry.sort_order : typeof entry.sortOrder === 'number' ? entry.sortOrder : -1;
        return Math.max(max, value);
      }, -1) + 1;

      const hasPrimary = existingDraftImages.some((entry) => Boolean(entry.is_primary ?? entry.isPrimary));
      const shouldBePrimary = !hasPrimary;

      const nextDraftImages = [
        ...existingDraftImages,
        {
          product_id: (current.dedupeKey ?? current.jobId) as string,
          url,
          sort_order: nextSortOrder,
          is_primary: shouldBePrimary,
          kind: null,
          gender: null,
          vto_eligible: false,
          product_view: null,
          ghost_eligible: false,
          summary_eligible: false,
          filename,
        }
      ];

      const nextRawImages = [
        ...existingRawImages.filter((entry) => entry.originalUrl !== url),
        {
          originalUrl: url,
          storagePath,
          hash,
          sizeBytes: buffer.length,
          contentType,
          width: dimensions.width,
          height: dimensions.height,
          sortOrder: nextSortOrder,
          isPrimarySuggestion: shouldBePrimary,
          kindHint: null,
          genderHint: null,
          vtoEligibleHint: false,
          productId: (current.dedupeKey ?? current.jobId) as string,
          downloadedAt: new Date().toISOString(),
          productView: null,
          ghostEligible: false,
          summaryEligible: false,
          filename,
        }
      ];

      const patch: Partial<PipelineState> = {
        draft: {
          ...(current.draft ?? {}),
          images: nextDraftImages,
        },
        artifacts: {
          ...(current.artifacts ?? {}),
          rawImages: nextRawImages,
        },
      };

      await persistStatePatchAndSync(jobId, patch, 'hitl_phase1_pause');

      return { url, storagePath, hash, width: dimensions.width ?? null, height: dimensions.height ?? null, isPrimary: shouldBePrimary };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Upload failed';
      logger.error({ jobId, message }, 'Phase 1 image upload failed');
      reply.code(500);
      return { error: message };
    }
  });

  app.post('/jobs/:jobId/phase1/images/delete', {
    preHandler: authHook
  }, async (req, reply) => {
    const params = ParamsSchema.safeParse(req.params);
    if (!params.success) {
      reply.code(400);
      return { error: 'Invalid jobId' };
    }
    const body = Phase1ImageDeletePayload.safeParse(req.body);
    if (!body.success) {
      reply.code(400);
      return { error: 'Invalid payload' };
    }

    const { jobId } = params.data;
    const { url } = body.data;

    const current = await readState(jobId);
    if (!current) {
      reply.code(404);
      return { error: 'Job not found' };
    }

    const existingDraftImages = Array.isArray(current.draft?.images) ? (current.draft?.images as Array<Record<string, unknown>>) : [];
    const existingRawImages: DownloadedImageMetaT[] = (Array.isArray(current.artifacts?.rawImages) ? current.artifacts?.rawImages : [])
      .map(coerceDownloadedImageMeta)
      .filter((entry): entry is DownloadedImageMetaT => Boolean(entry));
    const existingDraftArtifacts: ExtractDraftImageT[] = (Array.isArray(current.artifacts?.draftImages) ? current.artifacts?.draftImages : [])
      .map((entry) => {
        const parsed = ExtractDraftImage.safeParse(entry);
        return parsed.success ? parsed.data : null;
      })
      .filter((entry): entry is ExtractDraftImageT => Boolean(entry));
    const existingImageUrls = Array.isArray(current.artifacts?.imageUrls)
      ? (current.artifacts?.imageUrls as unknown[]).filter((v): v is string => typeof v === 'string')
      : [];
    const existingClassifications: ImageClassificationT[] = (Array.isArray(current.artifacts?.imageClassifications) ? current.artifacts?.imageClassifications : [])
      .map((entry) => {
        const parsed = ImageClassification.safeParse(entry);
        return parsed.success ? parsed.data : null;
      })
      .filter((entry): entry is ImageClassificationT => Boolean(entry));

    const rawMatch = existingRawImages.find((entry) => typeof entry.originalUrl === 'string' && entry.originalUrl === url);
    const rawMatchAny = rawMatch as Record<string, unknown> | undefined;
    const storagePath =
      rawMatchAny && typeof rawMatchAny.storagePath === 'string'
        ? rawMatchAny.storagePath
        : rawMatchAny && typeof rawMatchAny.storage_path === 'string'
          ? rawMatchAny.storage_path
          : null;
    const hash = rawMatchAny && typeof rawMatchAny.hash === 'string' ? rawMatchAny.hash : null;

    const nextDraftImages = existingDraftImages.filter((entry) => !(typeof entry.url === 'string' && entry.url === url));
    const nextRawImages = existingRawImages.filter((entry) => !(typeof entry.originalUrl === 'string' && entry.originalUrl === url));
    const nextArtifactDraftImages = existingDraftArtifacts.filter((entry) => !(typeof entry.url === 'string' && entry.url === url));
    const nextImageUrls = existingImageUrls.filter((entry) => entry !== url);
    const nextClassifications = existingClassifications.filter((entry) => {
      if (storagePath && entry.storagePath === storagePath) return false;
      if (hash && entry.hash === hash) return false;
      return true;
    });

    const sortedRemaining = [...nextDraftImages].sort((a, b) => {
      const aOrder = typeof a.sort_order === 'number' ? a.sort_order : typeof a.sortOrder === 'number' ? a.sortOrder : 0;
      const bOrder = typeof b.sort_order === 'number' ? b.sort_order : typeof b.sortOrder === 'number' ? b.sortOrder : 0;
      return aOrder - bOrder;
    });

    const nextPrimaryUrl = (() => {
      const explicitPrimary = sortedRemaining.find((entry) => {
        const record = entry as Record<string, unknown>;
        return (record.is_primary ?? record.isPrimary) === true;
      });
      if (explicitPrimary && typeof explicitPrimary.url === 'string') return explicitPrimary.url;
      const fallback = sortedRemaining[0];
      return fallback && typeof fallback.url === 'string' ? fallback.url : null;
    })();

    const imagePatch: Array<Record<string, unknown>> = [{ url, _delete: true }];
    sortedRemaining.forEach((entry) => {
      const record = entry as Record<string, unknown>;
      const entryUrl = typeof record.url === 'string' ? record.url : null;
      if (!entryUrl) return;
      const desiredPrimary = entryUrl === nextPrimaryUrl;
      const currentPrimary = (record.is_primary ?? record.isPrimary) === true;
      if (currentPrimary !== desiredPrimary) {
        imagePatch.push({ url: entryUrl, is_primary: desiredPrimary });
      }
    });

    const currentProduct = (current.draft?.product as Record<string, unknown> | undefined) ?? undefined;
    const shouldUpdateProductImageUrl = currentProduct && typeof currentProduct.image_url === 'string' && currentProduct.image_url === url;
    const nextProduct = shouldUpdateProductImageUrl
      ? { ...currentProduct, image_url: nextPrimaryUrl }
      : currentProduct;

    const patch: Partial<PipelineState> = {
      draft: {
        ...(current.draft ?? {}),
        ...(nextProduct ? { product: nextProduct } : {}),
        images: imagePatch,
      },
      artifacts: {
        ...(current.artifacts ?? {}),
        rawImages: nextRawImages,
        draftImages: nextArtifactDraftImages,
        imageUrls: nextImageUrls,
        imageClassifications: nextClassifications,
      },
    };

    await persistStatePatchAndSync(jobId, patch, 'hitl_phase1_pause');

    logger.info({ jobId, url, storagePath, removedFromDraft: true }, 'Phase 1 image deleted');

    if (storagePath) {
      const stillReferenced = nextRawImages.some((entry) => {
        const record = entry as Record<string, unknown>;
        const candidate = typeof record.storagePath === 'string' ? record.storagePath : typeof record.storage_path === 'string' ? record.storage_path : null;
        return candidate === storagePath;
      });
      if (!stillReferenced) {
        const { error } = await supabaseAdmin.storage.from(config.STORAGE_BUCKET).remove([storagePath]);
        if (error) {
          logger.warn({ jobId, url, storagePath, message: error.message }, 'Unable to delete storage object for Phase 1 image');
        }
      }
    }

    return { deleted: true };
  });

  app.get('/jobs/:jobId', {
    preHandler: authHook
  }, async (req, reply) => {
    const parsed = ParamsSchema.safeParse(req.params);
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
    return state;
  });

  app.post('/jobs/:jobId/phase1', {
    preHandler: authHook
  }, async (req, reply) => {
    const params = ParamsSchema.safeParse(req.params);
    if (!params.success) {
      reply.code(400);
      return { error: 'Invalid jobId' };
    }
    const body = Phase1UpdatePayload.safeParse(req.body);
    if (!body.success) {
      reply.code(400);
      return { error: 'Invalid payload' };
    }

    const { jobId } = params.data;
    const { patch, complete, resumeData } = body.data;

    if (patch) {
      await persistStatePatchAndSync(jobId, { jobId, ...patch }, 'hitl_phase1_pause');
    }

    if (!complete) {
      return { jobId, updated: true, resumed: false };
    }

    try {
      const resumeSignal: PauseResumeSignal = {
        action: 'resume',
        actor: 'phase1',
        data: resumeData,
      };
      const state = await resumeConversation(boss, jobId, resumeSignal);
      return { jobId, resumed: true, state };
    } catch (err) {
      if (err instanceof ResumeError) {
        reply.code(400);
        return { error: err.message };
      }
      throw err;
    }
  });
}

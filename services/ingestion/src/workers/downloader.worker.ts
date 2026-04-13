import type PgBoss from 'pg-boss';
import crypto from 'node:crypto';
import axios from 'axios';
import sharp from 'sharp';
import { createLogger } from '../utils/logger';
import { TOPICS } from '../queue/topics';
import { DownloadPayload, DownloadedImageMetaT } from '../domain/contracts';
import { getArtifactJson, uploadRawImage } from '../adapters/storage/supabase-storage';
import { persistStatePatch, readState } from '../domain/state-store';

const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15MB guard
const DOWNLOAD_TIMEOUT = 30_000; // 30 seconds

async function downloadImageBuffer(url: string) {
  const response = await axios.get<ArrayBuffer>(url, {
    responseType: 'arraybuffer',
    timeout: DOWNLOAD_TIMEOUT,
    maxContentLength: MAX_FILE_BYTES,
    headers: {
      'User-Agent': 'query-your-helper/ingestion-downloader'
    },
    validateStatus: (status) => status >= 200 && status < 400
  });
  const buffer = Buffer.from(response.data);
  if (buffer.length > MAX_FILE_BYTES) {
    throw new Error(`file-too-large:${buffer.length}`);
  }
  const contentType = response.headers['content-type'] ?? 'image/jpeg';
  return { buffer, contentType };
}

async function inferDimensions(buffer: Buffer) {
  try {
    const metadata = await sharp(buffer).metadata();
    return { width: metadata.width, height: metadata.height };
  } catch {
    return { width: undefined, height: undefined };
  }
}

export async function registerDownloadWorker(boss: PgBoss) {
  const logger = createLogger({ stage: 'download' });

  await boss.work(TOPICS.DOWNLOAD, async (job) => {
    const parsed = DownloadPayload.safeParse(job.data);
    if (!parsed.success) {
      logger.error({ jobId: job.id, issues: parsed.error.issues }, 'Invalid download payload');
      return;
    }

    const { jobId, originalUrl, dedupeKey, artifactRefs } = parsed.data;
    if (!artifactRefs?.extractedPath) {
      logger.warn({ jobId }, 'Downloader invoked without extractedPath');
      await persistStatePatch(jobId, {
        jobId,
        originalUrl,
        dedupeKey,
        flags: { downloadReady: true }
      });
      return;
    }

    try {
      logger.info({ jobId, extractedPath: artifactRefs.extractedPath }, 'Downloader started');

      const extract = await getArtifactJson(artifactRefs.extractedPath);
      const draftImages = Array.isArray(extract?.draft_images) ? extract.draft_images : [];
      if (draftImages.length === 0) {
        logger.warn({ jobId }, 'No draft images found');
        await persistStatePatch(jobId, {
          jobId,
          originalUrl,
          dedupeKey,
          artifacts: {
            draftImages: []
          },
          flags: { downloadReady: true }
        });
        return;
      }

      const seen = new Set<string>();
      const workList = draftImages.filter((img: any) => {
        const url = typeof img?.url === 'string' ? img.url.trim() : '';
        if (!url) return false;
        if (seen.has(url)) return false;
        seen.add(url);
        return true;
      });

      logger.info({ jobId, uniqueUrls: workList.length }, 'Downloader deduped URLs');

      const existingState = await readState(jobId);
      const already = new Map<string, DownloadedImageMetaT>();
      if (existingState?.artifacts?.rawImages) {
        for (const img of existingState.artifacts.rawImages) {
          already.set(img.originalUrl, img);
        }
      }

      const results: DownloadedImageMetaT[] = [];
      const validations: Array<{ code: string; message: string }> = [];

      for (const img of workList) {
        const url = img.url as string;
        const existing = already.get(url);
        if (existing) {
          logger.info({ jobId, url }, 'Downloader reused existing raw image');
          results.push(existing);
          continue;
        }

        try {
          logger.info({ jobId, url }, 'Downloader fetching image');
          const { buffer, contentType } = await downloadImageBuffer(url);
          const hash = crypto.createHash('sha256').update(buffer).digest('hex');
          const { width, height } = await inferDimensions(buffer);
          const storagePath = await uploadRawImage(jobId, hash, buffer, contentType);

          const record: DownloadedImageMetaT = {
            originalUrl: url,
            storagePath,
            hash,
            sizeBytes: buffer.length,
            contentType,
            width,
            height,
            sortOrder: img.sort_order ?? img.sortOrder ?? 0,
            isPrimarySuggestion: Boolean(img.is_primary ?? img.isPrimary),
            kindHint: img.kind ?? null,
            genderHint: img.gender ?? null,
            vtoEligibleHint: img.vto_eligible ?? img.vtoEligible ?? false,
            productId: img.product_id ?? dedupeKey,
            downloadedAt: new Date().toISOString()
          };

          results.push(record);
          logger.info({ jobId, url, storagePath }, 'Downloader stored image');
        } catch (err) {
          logger.error({ jobId, url, error: String(err) }, 'Downloader failed image');
          validations.push({ code: 'download_failed', message: `Failed to download image ${url}` });
        }
      }

      await persistStatePatch(jobId, {
        jobId,
        originalUrl,
        dedupeKey,
        artifacts: {
          draftImages,
          rawImages: results
        },
        flags: {
          downloadReady: true
        },
        draft: validations.length ? { validations } : undefined
      });

      if (results.length) {
        await boss.send(
          TOPICS.CLASSIFY,
          {
            jobId,
            originalUrl,
            dedupeKey,
            images: results.map((img) => ({
              storagePath: img.storagePath,
              hash: img.hash,
              originalUrl: img.originalUrl,
              sortOrder: img.sortOrder,
              isPrimarySuggestion: img.isPrimarySuggestion,
              kindHint: img.kindHint ?? null,
              genderHint: img.genderHint ?? null,
              vtoEligibleHint: img.vtoEligibleHint ?? false
            }))
          },
          { retryLimit: 3, retryBackoff: true }
        );
      }

      logger.info({ jobId, stored: results.length }, 'Downloader completed');
    } catch (err: any) {
      logger.error({ jobId, error: String(err?.message || err) }, 'Downloader failed');
      throw err;
    }
  });
}


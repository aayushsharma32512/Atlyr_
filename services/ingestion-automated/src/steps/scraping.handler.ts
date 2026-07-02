import type { StepHandler, IngestionPipelineJob } from '../domain/types';
import { saveArtifact } from '../domain/artifacts';
import { advanceAndTrigger } from '../orchestration/advance-and-trigger';
import { scrapeProductPage } from '../adapters/firecrawl';
import { uploadToSupabase } from '../utils/storage';
import { createLogger } from '../utils/logger';

const logger = createLogger({ stage: 'scraping' });

async function downloadImage(url: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Atlyr-Bot/1.0)' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!resp.ok) return null;
    const contentType = resp.headers.get('content-type') ?? 'image/jpeg';
    const buf = await resp.arrayBuffer();
    return { bytes: new Uint8Array(buf), contentType };
  } catch {
    return null;
  }
}

function extensionFromContentType(ct: string): string {
  if (ct.includes('png'))  return 'png';
  if (ct.includes('webp')) return 'webp';
  if (ct.includes('gif'))  return 'gif';
  return 'jpg';
}

export class ScrapingHandler implements StepHandler {
  async validate(job: IngestionPipelineJob): Promise<void> {
    if (!job.product_url) throw new Error('Missing product_url');
  }

  async execute(job: IngestionPipelineJob): Promise<void> {
    const { job_id, product_url } = job;
    logger.info({ jobId: job_id }, 'scraping product page');

    const result = await scrapeProductPage(product_url);
    logger.info({ jobId: job_id, imageCount: result.imageUrls.length }, 'firecrawl done');

    // Download images and upload to storage
    let uploadedCount = 0;
    for (let i = 0; i < result.imageUrls.length; i++) {
      const originalUrl = result.imageUrls[i];
      const downloaded = await downloadImage(originalUrl);
      if (!downloaded) {
        logger.warn({ jobId: job_id, url: originalUrl }, 'image download failed, skipping');
        continue;
      }

      const ext = extensionFromContentType(downloaded.contentType);
      const storagePath = `${job_id}/raw/${i}.${ext}`;
      const publicUrl = await uploadToSupabase(storagePath, downloaded.bytes, downloaded.contentType);

      await saveArtifact({
        jobId:        job_id,
        stepName:     'scraping',
        artifactType: 'raw_image',
        storagePath,
        data: {
          index:        i,
          original_url: originalUrl,
          public_url:   publicUrl,
          content_type: downloaded.contentType,
        },
      });
      uploadedCount++;
    }

    if (uploadedCount === 0) throw new Error('All image downloads failed — cannot proceed');

    // Save crawl metadata
    await saveArtifact({
      jobId:        job_id,
      stepName:     'scraping',
      artifactType: 'crawl_meta',
      data: {
        final_url:       result.finalUrl,
        brand:           result.meta.brand,
        product_name:    result.meta.product_name,
        description:     result.meta.description,
        price:           result.meta.price,
        currency:        result.meta.currency,
        color:           result.meta.color,
        raw_image_urls:  result.imageUrls,
        uploaded_count:  uploadedCount,
        scraped_at:      new Date().toISOString(),
      },
    });

    logger.info({ jobId: job_id, uploadedCount }, 'scraping complete');
    await advanceAndTrigger(job);
  }
}

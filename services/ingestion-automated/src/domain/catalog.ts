import { createHash } from 'node:crypto';
import { supabaseAdmin } from '../db/supabase';
import { getLatestArtifact } from './artifacts';
import { updateJob } from './job-catalog';
import { removeStoragePrefix } from '../utils/storage';
import type { IngestionPipelineJob } from './types';

// item_type enum (supabase/migrations/20250717195740_initial_schema.sql):
// top | bottom | shoes | accessory | occasion. Existing catalog rows for dresses are 'top'.
const TYPE_MAP: Record<IngestionPipelineJob['product_type'], string> = {
  topwear: 'top',
  bottomwear: 'bottom',
  dress: 'top',
};

// Deterministic 40-hex id from the job id — lets both ingested_products and products upsert on the
// same primary key, so re-publishing a job never creates duplicates.
function catalogId(jobId: string): string {
  return createHash('sha1').update(jobId).digest('hex');
}

type Crawl = Record<string, unknown> | null | undefined;

/**
 * Pure mapping from a completed job + its artifacts to a catalog row. NOT-NULL columns
 * (id, type, brand, size, price, currency, image_url, description, color) always get a value.
 * image_url is the SEGMENTED cloth (ghost-mannequin style) to match existing catalog convention.
 * Enrichment columns the pipeline doesn't produce (vectors, vibes, fit, category_id, ...) are
 * left unset → NULL.
 */
export function buildCatalogRow(
  job: IngestionPipelineJob,
  crawl: Crawl,
  garmentSummary: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const c = (crawl ?? {}) as Record<string, unknown>;
  const image = job.segmented_image_url;
  if (!image) throw new Error('segmented_image_url missing — cannot build catalog row');

  const priceRaw = c.price;
  const price = typeof priceRaw === 'number' ? Math.round(priceRaw) : 0;

  return {
    id: catalogId(job.job_id),
    type: TYPE_MAP[job.product_type] ?? 'top',
    brand: (c.brand as string) || 'Unknown',
    size: 'Unavailable', // pipeline has no size signal
    price,
    currency: (c.currency as string) || 'INR',
    image_url: image,
    description: (c.description as string) || '',
    color: (c.color as string) || 'NA',
    gender: job.product_gender_type,
    product_name: (c.product_name as string) ?? null,
    type_category: job.product_sub_type || null,
    product_url: job.product_url,
    care: (c.care as string) ?? null,
    garment_summary_front: garmentSummary ?? null,
  };
}

/** Columns that only exist on the staging table — stripped before writing to live `products`. */
const STAGING_ONLY = ['pipeline_job_id', 'segmented_image_url', 'verdict', 'verdict_at', 'verdict_by', 'discard_reason'];

/**
 * Stage a completed job into ingested_products (idempotent upsert on the deterministic id) and
 * point the job row at it. Returns the catalog id.
 */
export async function upsertIngestedProduct(job: IngestionPipelineJob): Promise<string> {
  const [crawlMeta, garment] = await Promise.all([
    getLatestArtifact(job.job_id, 'crawl_meta'),
    getLatestArtifact(job.job_id, 'garment_summary'),
  ]);

  const row: Record<string, unknown> = {
    ...buildCatalogRow(job, crawlMeta?.data as Crawl, garment?.data as Record<string, unknown> | null),
    pipeline_job_id: job.job_id,
    segmented_image_url: job.segmented_image_url,
  };
  const id = row.id as string;

  const { error } = await supabaseAdmin.from('ingested_products').upsert(row, { onConflict: 'id' });
  if (error) throw new Error(`upsert ingested_products failed: ${error.message}`);

  if (job.ingested_product_id !== id) {
    await updateJob(job.job_id, { ingested_product_id: id });
  }
  return id;
}

/**
 * Promote a staged job to the live `products` table (idempotent upsert on the same id), then mark
 * the staging row live. Self-heals by re-staging first, so it works even if the auto-write on
 * completion was skipped or failed.
 */
export async function publishToProducts(job: IngestionPipelineJob): Promise<string> {
  const id = await upsertIngestedProduct(job);

  const { data: staged, error: readErr } = await supabaseAdmin
    .from('ingested_products')
    .select('*')
    .eq('id', id)
    .single();
  if (readErr || !staged) throw new Error(`read staged row failed: ${readErr?.message ?? 'not found'}`);

  const productRow: Record<string, unknown> = { ...staged };
  for (const col of STAGING_ONLY) delete productRow[col];

  const { error: prodErr } = await supabaseAdmin.from('products').upsert(productRow, { onConflict: 'id' });
  if (prodErr) throw new Error(`upsert products failed: ${prodErr.message}`);

  // verdict check constraint allows only 'approved' | 'discarded' — 'approved' marks it live.
  const { error: verdictErr } = await supabaseAdmin
    .from('ingested_products')
    .update({ verdict: 'approved', verdict_at: new Date().toISOString() })
    .eq('id', id);
  if (verdictErr) throw new Error(`mark live failed: ${verdictErr.message}`);

  return id;
}

/**
 * Fully remove a job and everything derived from it. Order matters for foreign keys:
 * pipeline_step_artifacts cascade on job delete, but segmentation_jobs and ingested_products both
 * reference the job WITHOUT cascade, and the job references ingested_products via
 * ingested_product_id — so we unlink and delete those first.
 */
export async function deleteJobCompletely(job: IngestionPipelineJob): Promise<void> {
  const jobId = job.job_id;

  // 1. Storage (best-effort): raw/tryon/manual-placement live under `${jobId}/`, the automated
  //    placement composite under `placement/${jobId}/`.
  await removeStoragePrefix(`${jobId}/`);
  await removeStoragePrefix(`placement/${jobId}/`);

  // 2. Catalog rows, if this job was ever staged/published.
  if (job.ingested_product_id) {
    const productId = job.ingested_product_id;
    await updateJob(jobId, { ingested_product_id: null }); // clear FK before deleting the target
    const { error: prodErr } = await supabaseAdmin.from('products').delete().eq('id', productId);
    if (prodErr) throw new Error(`delete products failed: ${prodErr.message}`);
  }
  // Also clear by pipeline_job_id in case a staging row exists without the job FK set.
  const { error: ingErr } = await supabaseAdmin.from('ingested_products').delete().eq('pipeline_job_id', jobId);
  if (ingErr) throw new Error(`delete ingested_products failed: ${ingErr.message}`);

  // 3. segmentation_jobs (no cascade from job; its own children DO cascade off seg_job_id).
  const { error: segErr } = await supabaseAdmin.from('segmentation_jobs').delete().eq('pipeline_job_id', jobId);
  if (segErr) throw new Error(`delete segmentation_jobs failed: ${segErr.message}`);

  // 4. The job row — pipeline_step_artifacts cascade automatically.
  const { error: jobErr } = await supabaseAdmin.from('ingestion_pipeline_jobs').delete().eq('job_id', jobId);
  if (jobErr) throw new Error(`delete job failed: ${jobErr.message}`);
}

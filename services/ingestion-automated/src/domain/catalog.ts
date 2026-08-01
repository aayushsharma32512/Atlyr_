import { createHash } from 'node:crypto';
import { supabaseAdmin } from '../db/supabase';
import { pgPool } from '../db/pg';
import { getLatestArtifact, getArtifacts } from './artifacts';
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
export function catalogId(jobId: string): string {
  return createHash('sha1').update(jobId).digest('hex');
}

type Crawl = Record<string, unknown> | null | undefined;

// ─── Placement transform → `placement` JSONB map ─────────────────────────────────────────────
// The studio renders each garment on the 1800x3072 placement mannequin using the affine transform
// {tx, ty, scale, rotationDeg} + warp lattice the mesh editor / Modal placement service produce.
// Persisted as ONE JSONB column `placement`: a map of "gender:body_type" -> transform entry, so a
// single product row can carry a placement per mannequin. The legacy 2D columns
// (placement_x/placement_y/image_length) are separate and left untouched.

export type PlacementEntry = {
  tx: number;
  ty: number;
  scale: number;
  rotationDeg: number;
  warp: Array<{ x: number; y: number }>;
};

// Only body_type the studio uses today; the key stays general (gender:body_type) for the future.
export const DEFAULT_BODY_TYPE = 'bodytype1';

/** Normalize a mannequin signal (Modal's 'Female'/'Male', or a job gender) to 'male' | 'female'. */
export function normalizeMannequin(
  selected: unknown,
  gender?: IngestionPipelineJob['product_gender_type'] | string | null,
): 'male' | 'female' {
  const s = String(selected ?? gender ?? '').toLowerCase();
  if (s.includes('female')) return 'female';
  if (s.includes('male')) return 'male';
  // unisex / unknown → default to male (placement mannequins are male|female only).
  return 'male';
}

/** Composite map key, e.g. "male:bodytype1". */
export function placementKey(mannequin: 'male' | 'female', bodyType: string = DEFAULT_BODY_TYPE): string {
  return `${mannequin}:${bodyType}`;
}

/**
 * Map a placement artifact's data (or a raw transform + mannequin) to a { key, entry } pair for the
 * `placement` map. Returns null when there is no usable transform (so we never overwrite with 0s).
 */
export function placementEntryFrom(
  input: { transform?: { scale?: number; rotationDeg?: number; tx?: number; ty?: number } | null; warp?: unknown; selectedMannequin?: unknown; mannequin?: unknown } | null | undefined,
  gender?: IngestionPipelineJob['product_gender_type'] | string | null,
  bodyType: string = DEFAULT_BODY_TYPE,
): { key: string; entry: PlacementEntry } | null {
  const t = input?.transform;
  if (!t || typeof t.scale !== 'number' || typeof t.tx !== 'number' || typeof t.ty !== 'number') return null;
  const warp = Array.isArray(input?.warp)
    ? (input!.warp as unknown[]).filter((w): w is { x: number; y: number } =>
        !!w && typeof (w as any).x === 'number' && typeof (w as any).y === 'number')
    : [];
  const mannequin = normalizeMannequin(input?.mannequin ?? input?.selectedMannequin, gender);
  return {
    key: placementKey(mannequin, bodyType),
    entry: {
      tx: t.tx,
      ty: t.ty,
      scale: t.scale,
      rotationDeg: typeof t.rotationDeg === 'number' ? t.rotationDeg : 0,
      warp,
    },
  };
}

/**
 * Map a placement artifact to EVERY placement entry it carries.
 *
 * The Modal pipeline registers the garment against both mannequins on every run and now returns a
 * transform for each one that passed the acceptance bar (`transforms`, keyed "Female"/"Male").
 * Storing them all is what lets the studio show a user their own body instead of whichever mannequin
 * the garment happened to score best against — a unisex top gets both entries, so either user sees
 * themselves.
 *
 * Falls back to the single `transform` when `transforms` is absent, so artifacts written before the
 * pipeline was redeployed keep working unchanged.
 */
export function placementEntriesFrom(
  input:
    | {
        transform?: { scale?: number; rotationDeg?: number; tx?: number; ty?: number } | null;
        transforms?: Record<string, { scale?: number; rotationDeg?: number; tx?: number; ty?: number }> | null;
        warp?: unknown;
        selectedMannequin?: unknown;
        mannequin?: unknown;
      }
    | null
    | undefined,
  gender?: IngestionPipelineJob['product_gender_type'] | string | null,
  bodyType: string = DEFAULT_BODY_TYPE,
): { key: string; entry: PlacementEntry }[] {
  const many = input?.transforms;
  if (many && typeof many === 'object' && Object.keys(many).length > 0) {
    const out: { key: string; entry: PlacementEntry }[] = [];
    for (const [mannequin, transform] of Object.entries(many)) {
      // Reuse the singular mapper so the warp/validation rules stay in exactly one place; the
      // mannequin name from the pipeline overrides the product gender for the key.
      const one = placementEntryFrom({ ...input, transform, mannequin }, gender, bodyType);
      if (one) out.push(one);
    }
    if (out.length) return out;
  }
  const single = placementEntryFrom(input, gender, bodyType);
  return single ? [single] : [];
}

/**
 * Merge ONE placement entry into the `placement` JSONB map for a product id, on whichever of
 * products / ingested_products the row exists (both share the deterministic id). The `||` merge
 * preserves other keys (e.g. a female placement isn't clobbered when saving the male one).
 *
 * Uses a direct Postgres connection (not PostgREST): a placement save must be reliable even when
 * the Supabase REST layer is under load, and the write touches only the placement column.
 */
export async function writePlacementEntry(productId: string, key: string, entry: PlacementEntry): Promise<void> {
  const pool = pgPool();
  const entryJson = JSON.stringify(entry);
  for (const table of ['ingested_products', 'products'] as const) {
    await pool.query(
      `UPDATE public.${table}
         SET placement = COALESCE(placement, '{}'::jsonb) || jsonb_build_object($1::text, $2::jsonb)
       WHERE id = $3`,
      [key, entryJson, productId],
    );
  }
}

/** The three legacy 2D columns that drive the SVG avatar. Units differ from the 3D transform. */
export type Placement2D = {
  /** Horizontal offset as a percentage of the GARMENT's rendered width (not the canvas). */
  placement_x: number;
  /** Vertical offset as a percentage of the avatar's body height, measured from the chin. */
  placement_y: number;
  /** Garment length in cm — the renderer scales the image to pxPerCm * image_length. */
  image_length: number;
};

/**
 * Write the legacy 2D placement columns for a product id, on both products / ingested_products
 * (they share the deterministic id, so the UPDATE is a no-op on whichever lacks the row).
 *
 * Deliberately touches ONLY these three columns — the 3D `placement` JSONB map is never read or
 * written here, so editing a garment's 2D placement can never disturb its mesh transform.
 */
export async function writePlacement2D(productId: string, values: Placement2D): Promise<void> {
  const pool = pgPool();
  for (const table of ['ingested_products', 'products'] as const) {
    await pool.query(
      `UPDATE public.${table}
         SET placement_x = $1, placement_y = $2, image_length = $3
       WHERE id = $4`,
      [values.placement_x, values.placement_y, values.image_length, productId],
    );
  }
}

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
  enrichment?: Record<string, unknown> | null,
  placement?: Record<string, unknown> | null,
): Record<string, unknown> {
  const c = (crawl ?? {}) as Record<string, unknown>;
  const e = (enrichment ?? {}) as Record<string, unknown>;
  const image = job.segmented_image_url;
  if (!image) throw new Error('segmented_image_url missing — cannot build catalog row');

  // Note: `placement` is written separately via writePlacementEntry (a merge) so we never clobber
  // other body-type keys on a plain re-stage; it is intentionally NOT part of the upsert row.
  void placement;

  const priceRaw = c.price;
  const price = typeof priceRaw === 'number' ? Math.round(priceRaw) : 0;

  // vibes is a TEXT column in the catalog (comma-joined), matching the old HITL pipeline.
  const vibes = Array.isArray(e.vibes) ? (e.vibes as unknown[]).filter((v) => typeof v === 'string').join(', ') : null;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

  return {
    id: catalogId(job.job_id),
    type: TYPE_MAP[job.product_type] ?? 'top',
    brand: (c.brand as string) || 'Unknown',
    size: 'Unavailable', // pipeline has no size signal
    price,
    currency: (c.currency as string) || 'INR',
    image_url: image,
    description: (c.description as string) || '',
    // Fall back to the enrichment color_group when the scrape found no color (was 'NA' before).
    color: (c.color as string) || str(e.color_group) || 'NA',
    gender: job.product_gender_type,
    product_name: (c.product_name as string) ?? null,
    // Prefer the enrichment's specific type_category (e.g. "Oversized T-shirt") over the raw sub_type.
    type_category: str(e.type_category) || job.product_sub_type || null,
    product_url: job.product_url,
    care: (c.care as string) || str(e.care) || null,
    garment_summary_front: garmentSummary ?? null,
    garment_summary_version: str((garmentSummary ?? {} as Record<string, unknown>)?.['prompt_version']),
    // ── Merchandising enrichment (parity with old HITL enrichNode) ──
    fit:                    str(e.fit),
    feel:                   str(e.feel),
    vibes,
    occasion:               str(e.occasion),
    material_type:          str(e.material_type),
    color_group:            str(e.color_group),
    description_text:       str(e.description_text),
    product_specifications: (e.product_specifications && typeof e.product_specifications === 'object') ? e.product_specifications : null,
  };
}

/** Columns that only exist on the staging table — stripped before writing to live `products`. */
const STAGING_ONLY = ['pipeline_job_id', 'segmented_image_url', 'verdict', 'verdict_at', 'verdict_by', 'discard_reason'];

// ─── Image rows (parity with old HITL ingested_product_images / product_images) ──────────────
// The old pipeline wrote one image row per scraped/ghost image; the automated pipeline stored
// images only as pipeline_step_artifacts. We reconstruct catalog image rows from the
// image_classification + raw_image artifacts, plus the generated VTON and segmented (ghost) images.

type ImageRow = {
  url: string;
  kind: 'flatlay' | 'model' | 'detail' | 'ghost';
  product_view: 'front' | 'back' | 'side' | 'detail' | null;
  sort_order: number;
  is_primary: boolean;
  vto_eligible: boolean;
  ghost_eligible: boolean;
  summary_eligible: boolean;
  gender: 'male' | 'female' | null;
};

function mapKind(stage1Winner: unknown): 'flatlay' | 'model' | 'detail' {
  const s = String(stage1Winner ?? '').toLowerCase();
  if (s.includes('flat')) return 'flatlay';
  if (s.includes('model')) return 'model';
  return 'detail';
}

function mapView(stage2Winner: unknown): 'front' | 'back' | 'side' | 'detail' | null {
  const s = String(stage2Winner ?? '').toLowerCase();
  return (['front', 'back', 'side', 'detail'] as const).find((v) => s.includes(v)) ?? null;
}

async function buildImageRows(job: IngestionPipelineJob): Promise<ImageRow[]> {
  const [classifications, rawImages] = await Promise.all([
    getArtifacts(job.job_id, 'image_classification'),
    getArtifacts(job.job_id, 'raw_image'),
  ]);

  const gender = job.product_gender_type === 'unisex' ? null : job.product_gender_type;
  const preferred = job.v_ton_preferred_image;

  // index each raw image by its public url so scraped images keep their scrape order
  const indexByUrl = new Map<string, number>();
  for (const r of rawImages) {
    const d = (r.data ?? {}) as Record<string, unknown>;
    if (typeof d.public_url === 'string' && typeof d.index === 'number') indexByUrl.set(d.public_url, d.index);
  }

  const rows: ImageRow[] = [];

  // 1) Scraped, classified images (flatlay / model / detail, with front/back/side view)
  for (const c of classifications) {
    const d = (c.data ?? {}) as Record<string, unknown>;
    const url = d.public_url as string | undefined;
    if (!url) continue;
    const view = mapView(d.stage2_winner);
    rows.push({
      url,
      kind: mapKind(d.stage1_winner),
      product_view: view,
      sort_order: indexByUrl.get(url) ?? rows.length,
      is_primary: false,
      vto_eligible: url === preferred,
      ghost_eligible: false,
      summary_eligible: url === preferred,
      gender,
    });
  }
  rows.sort((a, b) => a.sort_order - b.sort_order);

  // 2) Generated VTON try-on (kind 'model', vto-eligible)
  let order = rows.length;
  if (job.vton_image_url) {
    rows.push({
      url: job.vton_image_url, kind: 'model', product_view: 'front', sort_order: order++,
      is_primary: false, vto_eligible: true, ghost_eligible: false, summary_eligible: false, gender,
    });
  }

  // 3) Segmented ghost-mannequin image — this is the catalog hero (image_url), so mark it primary.
  if (job.segmented_image_url) {
    rows.push({
      url: job.segmented_image_url, kind: 'ghost', product_view: 'front', sort_order: order++,
      is_primary: true, vto_eligible: false, ghost_eligible: true, summary_eligible: false, gender,
    });
  }

  // Exactly one primary: prefer the ghost row; otherwise the first scraped image.
  if (!rows.some((r) => r.is_primary) && rows.length) rows[0].is_primary = true;

  return rows;
}

/** Full-replace image rows for a product (mirrors the old stage/promote DELETE-then-INSERT). */
async function syncImageRows(table: 'ingested_product_images' | 'product_images', productId: string, rows: ImageRow[], jobId?: string): Promise<void> {
  const { error: delErr } = await supabaseAdmin.from(table).delete().eq('product_id', productId);
  if (delErr) throw new Error(`clear ${table} failed: ${delErr.message}`);
  if (!rows.length) return;
  const payload = rows.map((r) => ({
    product_id: productId,
    ...r,
    ...(jobId ? { pipeline_job_id: jobId } : {}),
  }));
  const { error: insErr } = await supabaseAdmin.from(table).insert(payload);
  if (insErr) throw new Error(`insert ${table} failed: ${insErr.message}`);
}

/**
 * Stage a completed job into ingested_products (idempotent upsert on the deterministic id) and
 * point the job row at it. Returns the catalog id.
 */
export async function upsertIngestedProduct(job: IngestionPipelineJob): Promise<string> {
  const [crawlMeta, garment, enrichment, placement] = await Promise.all([
    getLatestArtifact(job.job_id, 'crawl_meta'),
    getLatestArtifact(job.job_id, 'garment_summary'),
    getLatestArtifact(job.job_id, 'enrichment'),
    getLatestArtifact(job.job_id, 'placement'),
  ]);

  const row: Record<string, unknown> = {
    ...buildCatalogRow(
      job,
      crawlMeta?.data as Crawl,
      garment?.data as Record<string, unknown> | null,
      enrichment?.data as Record<string, unknown> | null,
      placement?.data as Record<string, unknown> | null,
    ),
    pipeline_job_id: job.job_id,
    segmented_image_url: job.segmented_image_url,
  };
  const id = row.id as string;

  const { error } = await supabaseAdmin.from('ingested_products').upsert(row, { onConflict: 'id' });
  if (error) throw new Error(`upsert ingested_products failed: ${error.message}`);

  // Catalog image rows (FK → ingested_products, so only after the product row exists).
  const imageRows = await buildImageRows(job);
  await syncImageRows('ingested_product_images', id, imageRows, job.job_id);

  // Placement (auto from Modal, or a prior manual edit) → merge into the `placement` map so it
  // survives re-stage and doesn't clobber other body-type keys.
  // One entry per mannequin the garment registered against — the merge is per key, so writing male
  // never clobbers female (or a manual edit to either).
  for (const e of placementEntriesFrom(placement?.data as never, job.product_gender_type)) {
    await writePlacementEntry(id, e.key, e.entry);
  }

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

  // Mirror the image rows into the live product_images table (no pipeline_job_id column there).
  const imageRows = await buildImageRows(job);
  await syncImageRows('product_images', id, imageRows);

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

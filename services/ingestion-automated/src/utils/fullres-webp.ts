/**
 * Full-resolution WebP re-encode of the garment cut-out that gets WORN on the mannequin.
 *
 * The segmented PNG the pipeline produces is 1.4-2.5MB and is loaded at full size on every try-on.
 * A WebP re-encode cuts that by ~85% with no visible loss, so the catalog serves the `.fullres.webp`
 * sibling instead.
 *
 * ── The one rule ──
 *
 * Format-only, at IDENTICAL dimensions, asserted per image before upload. The placement transform
 * and its 88-point warp lattice are both measured in this image's own pixel space, so a re-encode is
 * invisible to that maths and a resize would deform every garment ever placed. That is also why the
 * 400px `thumbnail_url` can never be worn, and why `.fullres.webp` needs a suffix of its own —
 * plain `.webp` is already taken by the thumbnail.
 *
 * The original is never deleted or overwritten; the sibling is added beside it, so reverting is one
 * UPDATE putting the old extension back.
 *
 * This mirrors scripts/backfill-fullres-webp.ts, which does the same conversion for rows ingested
 * before the pipeline did it inline. Keep SUFFIX and the encode options in sync with that script.
 */
import sharp from 'sharp';
import { supabaseAdmin } from '../db/supabase';
import { parsePublicUrl } from './storage';
import { createLogger } from './logger';

const logger = createLogger({ stage: 'fullres-webp' });

export const FULLRES_SUFFIX = '.fullres.webp';

const QUALITY = 90;
const ALPHA_QUALITY = 100;
const EFFORT = 5;

/** Sibling object path for a source path: replaces the trailing extension with `.fullres.webp`. */
export function fullresSiblingPath(path: string): string {
  if (path.endsWith(FULLRES_SUFFIX)) return path;
  return /\.[a-zA-Z0-9]+$/.test(path) ? path.replace(/\.[a-zA-Z0-9]+$/, FULLRES_SUFFIX) : path + FULLRES_SUFFIX;
}

/**
 * Ensure a `.fullres.webp` sibling exists for `sourceUrl` and return its public URL.
 *
 * Returns null when the conversion could not be done (unparseable URL, download/encode/upload
 * failure) — callers fall back to the original URL, which is exactly the pre-existing behaviour, and
 * the backfill script can mop it up later. A dimension change is the one condition that is NOT
 * recoverable: it would misplace the garment on every avatar it has ever been placed on, and nothing
 * downstream would flag it, so it aborts the conversion rather than uploading.
 *
 * Re-encodes unconditionally (upsert), so a segmented image a human has overwritten in place via
 * POST /jobs/:jobId/segmented-image gets a matching WebP on the next stage.
 */
export async function ensureFullresWebp(sourceUrl: string | null | undefined): Promise<string | null> {
  const url = (sourceUrl ?? '').trim();
  if (!url) return null;
  // Already converted (e.g. a re-stage of a job that has been through here before).
  if (url.includes(FULLRES_SUFFIX)) return url;

  const loc = parsePublicUrl(url);
  if (!loc) {
    logger.warn({ url }, 'not a Supabase storage URL — skipping WebP conversion');
    return null;
  }

  // The segmented image carries a ?v=<ts> cache-buster after a manual edit. Carry it onto the WebP
  // URL too: the sibling path is stable across edits, so without it a CDN can serve stale pixels.
  const query = url.includes('?') ? url.slice(url.indexOf('?')) : '';
  const outPath = fullresSiblingPath(loc.path);

  try {
    const dl = await supabaseAdmin.storage.from(loc.bucket).download(loc.path);
    if (dl.error || !dl.data) throw new Error(`download: ${dl.error?.message ?? 'no data'}`);
    const src = Buffer.from(await dl.data.arrayBuffer());

    const srcMeta = await sharp(src).metadata();
    const out = await sharp(src)
      .webp({ quality: QUALITY, alphaQuality: ALPHA_QUALITY, effort: EFFORT })
      .toBuffer();
    const outMeta = await sharp(out).metadata();
    if (srcMeta.width !== outMeta.width || srcMeta.height !== outMeta.height) {
      throw new Error(
        `dimensions changed ${srcMeta.width}x${srcMeta.height} -> ${outMeta.width}x${outMeta.height}`
      );
    }

    const up = await supabaseAdmin.storage
      .from(loc.bucket)
      .upload(outPath, out, { contentType: 'image/webp', upsert: true });
    if (up.error) throw new Error(`upload: ${up.error.message}`);

    const { data } = supabaseAdmin.storage.from(loc.bucket).getPublicUrl(outPath);
    logger.info(
      {
        bucket: loc.bucket,
        path: outPath,
        beforeKb: Math.round(src.length / 1024),
        afterKb: Math.round(out.length / 1024),
      },
      'fullres WebP written'
    );
    return `${data.publicUrl}${query}`;
  } catch (err) {
    logger.warn(
      { bucket: loc.bucket, path: loc.path, err: err instanceof Error ? err.message : String(err) },
      'fullres WebP conversion failed — keeping the original image'
    );
    return null;
  }
}

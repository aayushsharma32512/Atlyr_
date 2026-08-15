/**
 * 400px WebP thumbnails for catalog tiles.
 *
 * `products.thumbnail_url` feeds every grid tile and outfit card
 * (src/services/studio/studioService.ts, src/features/studio/mappers/renderedItemMapper.ts), which
 * resolve their image as `thumbnail_url || image_url`. When the column is NULL that fallback
 * silently serves the full-res 2K garment PNG — 1.3-2.5MB — into a ~90px tile.
 *
 * `image_url` is a different asset and is NOT this module's business: the studio hero wears it on
 * the 1800x3072 mannequin canvas, where a 400px texture would upscale ~7.7x. It stays PNG.
 *
 * Kept free of `../config` and the Supabase client on purpose — service config validates env at
 * import time and would kill the test process (see CLAUDE.md). The caller owns bucket + upload.
 */
import sharp from 'sharp';

/** Longest edge, matching the 828 thumbnails already in the catalog (scripts/recompress.py). */
export const THUMB_MAX = 400;
export const THUMB_QUALITY = 80;

/**
 * `.fullres.webp` is the full-resolution sibling (scripts/backfill-fullres-webp.ts) and `.webp`
 * alone is the thumbnail. Stripping it as a compound suffix — rather than letting the generic
 * extension rule match only the trailing `.webp` — is what stops a thumbnail write from landing on
 * top of a full-res texture.
 */
const FULLRES_SUFFIX = '.fullres.webp';

/** The `.webp` sibling of an object: same bucket, same directory, same basename. */
export function thumbnailPathFor(objectPath: string): string {
  const stem = objectPath.endsWith(FULLRES_SUFFIX)
    ? objectPath.slice(0, -FULLRES_SUFFIX.length)
    : objectPath.replace(/\.[a-zA-Z0-9]+$/, '');
  return `${stem}.webp`;
}

/**
 * Bucket + object path from a Supabase public URL. Derived from the URL rather than hardcoded:
 * these images live in at least two buckets (`ingestion-automated`, `ingested_inventory`), and a
 * parser pinned to one silently skips the other's products.
 */
export function parsePublicUrl(url: string, base: string): { bucket: string; path: string } | null {
  const marker = `${base.replace(/\/$/, '')}/storage/v1/object/public/`;
  if (!url.startsWith(marker)) return null;
  const rest = url.slice(marker.length).split('?')[0];
  const slash = rest.indexOf('/');
  if (slash <= 0 || slash === rest.length - 1) return null;
  return { bucket: rest.slice(0, slash), path: rest.slice(slash + 1) };
}

/**
 * Encode a garment cut-out down to the thumbnail box. `fit: 'inside'` + `withoutEnlargement`
 * mirrors PIL's `img.thumbnail()`, which produced the existing catalog thumbnails.
 *
 * `alphaQuality: 100` keeps the cut-out mask lossless — these garments are composited onto the
 * mannequin, and a lossy alpha channel shows up as halo fringing around the silhouette.
 */
export async function encodeThumbnail(src: Buffer | Uint8Array): Promise<Buffer> {
  return sharp(src)
    .resize(THUMB_MAX, THUMB_MAX, {
      fit: 'inside',
      withoutEnlargement: true,
      kernel: 'lanczos3',
    })
    .webp({ quality: THUMB_QUALITY, alphaQuality: 100 })
    .toBuffer();
}

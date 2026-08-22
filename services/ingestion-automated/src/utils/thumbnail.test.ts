import { describe, it, expect } from 'bun:test';
import sharp from 'sharp';
import { encodeThumbnail, parsePublicUrl, thumbnailPathFor, THUMB_MAX } from './thumbnail';

const BASE = 'https://hhqnvjxnsbwhmrldohbz.supabase.co';

/** A cut-out garment: opaque in the middle, fully transparent at the edges. */
async function rgbaPng(width: number, height: number): Promise<Buffer> {
  const px = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const inside = x > width / 4 && x < (width * 3) / 4;
      px[i] = 200;
      px[i + 1] = 30;
      px[i + 2] = 30;
      px[i + 3] = inside ? 255 : 0;
    }
  }
  return sharp(px, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

describe('thumbnailPathFor', () => {
  it('swaps the extension for .webp, keeping directory and basename', () => {
    expect(thumbnailPathFor('segmentation/7ccce18b-2e18-43d2-95f9-010e1e15e7d3/final.png')).toBe(
      'segmentation/7ccce18b-2e18-43d2-95f9-010e1e15e7d3/final.webp',
    );
  });

  it('handles the legacy ghost-mannequin .jpg objects', () => {
    expect(thumbnailPathFor('processed/ghost_mannequins/abc/front/1776523488931-b9e6.jpg')).toBe(
      'processed/ghost_mannequins/abc/front/1776523488931-b9e6.webp',
    );
  });

  // `.webp` is reserved for the 400px thumbnail; the full-res sibling uses `.fullres.webp`
  // (scripts/backfill-fullres-webp.ts). Treating that compound suffix as a plain extension would
  // map the path onto ITSELF, and writing a 400px image there would destroy the hero texture.
  it('strips the compound .fullres.webp suffix rather than mapping onto itself', () => {
    const src = 'segmentation/abc/final.fullres.webp';
    expect(thumbnailPathFor(src)).toBe('segmentation/abc/final.webp');
    expect(thumbnailPathFor(src)).not.toBe(src);
  });

  it('is idempotent on a path that is already the thumbnail', () => {
    expect(thumbnailPathFor('segmentation/abc/final.webp')).toBe('segmentation/abc/final.webp');
  });
});

describe('parsePublicUrl', () => {
  it('splits bucket from object path', () => {
    const url = `${BASE}/storage/v1/object/public/ingestion-automated/segmentation/abc/final.png`;
    expect(parsePublicUrl(url, BASE)).toEqual({
      bucket: 'ingestion-automated',
      path: 'segmentation/abc/final.png',
    });
  });

  it('drops the cache-busting query string', () => {
    const url = `${BASE}/storage/v1/object/public/ingestion-automated/segmentation/abc/final.png?v=1786636779685`;
    expect(parsePublicUrl(url, BASE)?.path).toBe('segmentation/abc/final.png');
  });

  // These images live in at least two buckets, so the bucket must come from the URL.
  it('reads the legacy inventory bucket too', () => {
    const url = `${BASE}/storage/v1/object/public/ingested_inventory/processed/x/y.jpg`;
    expect(parsePublicUrl(url, BASE)?.bucket).toBe('ingested_inventory');
  });

  it('returns null for a URL outside this Supabase project', () => {
    expect(parsePublicUrl('https://example.com/final.png', BASE)).toBeNull();
    expect(parsePublicUrl(`${BASE}/storage/v1/object/public/bucket-only`, BASE)).toBeNull();
  });
});

describe('encodeThumbnail', () => {
  it('fits a 2K portrait garment inside 400px without distorting it', async () => {
    const out = await encodeThumbnail(await rgbaPng(768, 1344));
    const meta = await sharp(out).metadata();

    expect(meta.format).toBe('webp');
    expect(meta.height).toBe(THUMB_MAX);
    expect(meta.width).toBeLessThanOrEqual(THUMB_MAX);
    // aspect preserved to within a rounding pixel
    expect(Math.abs(meta.width! / meta.height! - 768 / 1344)).toBeLessThan(0.01);
  });

  it('preserves the cut-out alpha channel', async () => {
    const out = await encodeThumbnail(await rgbaPng(768, 1344));
    const meta = await sharp(out).metadata();
    expect(meta.hasAlpha).toBe(true);

    // Corner must stay fully transparent — lossy alpha shows as halo fringing on the mannequin.
    const { data } = await sharp(out).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(data[3]).toBe(0);
  });

  it('never enlarges an image that is already smaller than the box', async () => {
    const out = await encodeThumbnail(await rgbaPng(100, 150));
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(100);
    expect(meta.height).toBe(150);
  });

  it('is dramatically smaller than the source PNG', async () => {
    const src = await rgbaPng(768, 1344);
    const out = await encodeThumbnail(src);
    expect(out.byteLength).toBeLessThan(src.byteLength / 10);
  });
});

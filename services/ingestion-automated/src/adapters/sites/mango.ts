import {
  normalizeHostname,
  safeOriginFromUrl,
  normalizeUrl,
  dedupeByResolution,
} from './shared';

const MANGO_CDN_RE = /st\.mng\.com/i;

function scoreMangoImage(url: string): number {
  try {
    const p = new URL(url);
    const imwidth = p.searchParams.get('imwidth');
    if (imwidth) return Number(imwidth);
  } catch { /* ignore */ }
  return 0;
}

function mangoBaseKey(url: string): string {
  try {
    const p = new URL(url);
    p.searchParams.delete('imwidth');
    return p.toString().toLowerCase();
  } catch { return url.toLowerCase(); }
}

function extractImagesFromImageGrid(html: string, origin: string): string[] {
  const images: string[] = [];
  // Look for ImageGrid_imageGrid and ImageGridItem_image class blocks
  const gridRe = /ImageGrid_imageGrid[\s\S]{0,5000}?(?=<\/div>)/gi;
  for (const block of html.matchAll(gridRe)) {
    const srcRe = /src="([^"]+)"/gi;
    for (const m of block[0]!.matchAll(srcRe)) {
      const url = normalizeUrl(m[1]!, origin);
      if (url && MANGO_CDN_RE.test(url)) images.push(url);
    }
  }
  // Also match img tags with ImageGridItem_image class
  const itemRe = /ImageGridItem_image[^"]*"[\s\S]*?<\/div>/gi;
  for (const block of html.matchAll(itemRe)) {
    const srcRe = /src="([^"]+)"/gi;
    for (const m of block[0]!.matchAll(srcRe)) {
      const url = normalizeUrl(m[1]!, origin);
      if (url && MANGO_CDN_RE.test(url)) images.push(url);
    }
  }
  return images;
}

export function extractMangoImages(
  html: string,
  originalUrl: string,
  jsonImages: string[]
): string[] {
  const origin = safeOriginFromUrl(originalUrl, 'https://shop.mango.com');
  const fromHtml = extractImagesFromImageGrid(html, origin);
  const filtered = fromHtml.filter((u) => MANGO_CDN_RE.test(u));
  const deduped = dedupeByResolution(filtered, mangoBaseKey, scoreMangoImage);
  if (deduped.length > 0) return deduped;
  return jsonImages.filter((u) => MANGO_CDN_RE.test(u));
}

export const MANGO_HOSTNAMES = new Set([
  'mango.com',
  'shop.mango.com',
  'www.mango.com',
]);
export function isMango(hostname: string): boolean {
  return MANGO_HOSTNAMES.has(normalizeHostname(hostname));
}

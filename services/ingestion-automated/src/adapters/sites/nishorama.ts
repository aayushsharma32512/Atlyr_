import {
  normalizeHostname,
  safeOriginFromUrl,
  normalizeUrl,
  parseSrcsetLargest,
  looksLikeShopifyImageUrl,
  shopifyBaseAssetKey,
  parseShopifyResolutionScore,
  dedupeByResolution,
} from './shared';

function transformNishoramaUrl(url: string): string {
  try {
    const p = new URL(url);
    if (p.hostname.startsWith('www.')) {
      p.hostname = 'row.' + p.hostname.slice(4);
    }
    p.searchParams.delete('v');
    return p.toString();
  } catch { return url; }
}

function extractFromProductGallery(html: string, origin: string): string[] {
  const images: string[] = [];
  // product-gallery-new__media-item blocks
  const blockRe = /class="[^"]*product-gallery-new__media-item[^"]*"[\s\S]*?<\/li>/gi;
  for (const block of html.matchAll(blockRe)) {
    const b = block[0]!;
    const srcsetM = b.match(/srcset="([^"]+)"/i);
    if (srcsetM) {
      const best = parseSrcsetLargest(srcsetM[1]!);
      if (best) {
        const url = normalizeUrl(best, origin);
        if (url && looksLikeShopifyImageUrl(url)) { images.push(url); continue; }
      }
    }
    const srcM = b.match(/src="([^"]+)"/i);
    if (srcM) {
      const url = normalizeUrl(srcM[1]!, origin);
      if (url && looksLikeShopifyImageUrl(url)) images.push(url);
    }
  }
  return images;
}

export function extractNishoramaImages(
  html: string,
  originalUrl: string,
  jsonImages: string[]
): string[] {
  const origin = safeOriginFromUrl(originalUrl, 'https://www.nishorama.com');
  const fromHtml = extractFromProductGallery(html, origin);
  const transformed = fromHtml.map(transformNishoramaUrl);
  const deduped = dedupeByResolution(
    transformed.filter(looksLikeShopifyImageUrl),
    shopifyBaseAssetKey,
    parseShopifyResolutionScore
  );
  if (deduped.length > 0) return deduped;
  return jsonImages.filter(looksLikeShopifyImageUrl).map(transformNishoramaUrl);
}

export const NISHORAMA_HOSTNAMES = new Set(['nishorama.com', 'www.nishorama.com']);
export function isNishorama(hostname: string): boolean {
  return NISHORAMA_HOSTNAMES.has(normalizeHostname(hostname));
}

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

function extractImagesFromThumbItems(html: string, origin: string): string[] {
  const images: string[] = [];
  const thumbRe = /class="[^"]*product__thumb-item[^"]*"[\s\S]*?<\/li>/gi;
  for (const thumbBlock of html.matchAll(thumbRe)) {
    const block = thumbBlock[0]!;
    // srcset first
    const srcsetM = block.match(/srcset="([^"]+)"/i);
    if (srcsetM) {
      const best = parseSrcsetLargest(srcsetM[1]!);
      if (best) {
        const url = normalizeUrl(best, origin);
        if (url && looksLikeShopifyImageUrl(url)) { images.push(url); continue; }
      }
    }
    // src fallback
    const srcM = block.match(/src="([^"]+)"/i);
    if (srcM) {
      const url = normalizeUrl(srcM[1]!, origin);
      if (url && looksLikeShopifyImageUrl(url)) images.push(url);
    }
  }
  return images;
}

export function extractOffdutyImages(
  html: string,
  originalUrl: string,
  jsonImages: string[]
): string[] {
  const origin = safeOriginFromUrl(originalUrl, 'https://www.offduty.in');
  const fromHtml = extractImagesFromThumbItems(html, origin);
  const deduped = dedupeByResolution(
    fromHtml.filter(looksLikeShopifyImageUrl),
    shopifyBaseAssetKey,
    parseShopifyResolutionScore
  );
  if (deduped.length > 0) return deduped;
  return jsonImages.filter(looksLikeShopifyImageUrl);
}

export const OFFDUTY_HOSTNAMES = new Set(['offduty.in', 'www.offduty.in']);
export function isOffduty(hostname: string): boolean {
  return OFFDUTY_HOSTNAMES.has(normalizeHostname(hostname));
}

import {
  normalizeHostname,
  safeOriginFromUrl,
  normalizeUrl,
  looksLikeShopifyImageUrl,
  shopifyBaseAssetKey,
  parseShopifyResolutionScore,
  dedupeByResolution,
} from './shared';

function extractFromProductSlides(html: string, origin: string): string[] {
  const images: string[] = [];
  const slideRe = /class="[^"]*product-images__slide[^"]*"[\s\S]*?<\/li>/gi;
  for (const block of html.matchAll(slideRe)) {
    const b = block[0]!;
    const srcM = b.match(/(?:data-src|src)="([^"]+)"/i);
    if (srcM) {
      const url = normalizeUrl(srcM[1]!, origin);
      if (url && looksLikeShopifyImageUrl(url)) images.push(url);
    }
  }
  return images;
}

export function extractBonkerscornerImages(
  html: string,
  originalUrl: string,
  jsonImages: string[]
): string[] {
  const origin = safeOriginFromUrl(originalUrl, 'https://www.bonkerscorner.com');
  const fromHtml = extractFromProductSlides(html, origin);
  const deduped = dedupeByResolution(
    fromHtml.filter(looksLikeShopifyImageUrl),
    shopifyBaseAssetKey,
    parseShopifyResolutionScore
  );
  if (deduped.length > 0) return deduped;
  return jsonImages.filter(looksLikeShopifyImageUrl);
}

export const BONKERSCORNER_HOSTNAMES = new Set(['bonkerscorner.com', 'www.bonkerscorner.com']);
export function isBonkerscorner(hostname: string): boolean {
  return BONKERSCORNER_HOSTNAMES.has(normalizeHostname(hostname));
}

import {
  normalizeHostname,
  safeOriginFromUrl,
  normalizeUrl,
  dedupeByResolution,
} from './shared';

const NYKAA_CDN_RE = /adn-static1\.nykaa\.com|nykaa-media\.nykaa\.com/i;

function scoreNykaaImage(url: string): number {
  try {
    const p = new URL(url);
    const trw = p.searchParams.get('tr');
    if (trw) {
      const wM = trw.match(/w-(\d+)/i);
      if (wM) return Number(wM[1]);
    }
  } catch { /* ignore */ }
  return 0;
}

function nykaaBaseKey(url: string): string {
  try {
    const p = new URL(url);
    p.searchParams.delete('tr');
    return p.toString().toLowerCase();
  } catch { return url.toLowerCase(); }
}

function extractNykaaImagesFromHtml(html: string, origin: string): string[] {
  const images: string[] = [];
  // pdp-selector-img or pdp-product-image
  const containerRe = /class="[^"]*(?:pdp-selector-img|pdp-product-image|media-widget)[^"]*"[\s\S]*?(?=class="[^"]*(?:pdp-selector-img|pdp-product-image|media-widget|pdp-layout)|$)/gi;
  for (const block of html.matchAll(containerRe)) {
    const srcRe = /(?:src|data-src)="([^"]+)"/gi;
    for (const m of block[0]!.matchAll(srcRe)) {
      const url = normalizeUrl(m[1]!, origin);
      if (url && NYKAA_CDN_RE.test(url)) images.push(url);
    }
  }
  // Fallback: scan all img src/data-src for Nykaa CDN
  if (images.length === 0) {
    const imgRe = /(?:src|data-src)="([^"]+)"/gi;
    for (const m of html.matchAll(imgRe)) {
      const url = normalizeUrl(m[1]!, origin);
      if (url && NYKAA_CDN_RE.test(url) && !/thumbnail|icon/i.test(url)) images.push(url);
    }
  }
  return images;
}

export function extractNykaaImages(
  html: string,
  originalUrl: string,
  jsonImages: string[]
): string[] {
  const origin = safeOriginFromUrl(originalUrl, 'https://www.nykaa.com');
  const fromHtml = extractNykaaImagesFromHtml(html, origin);
  const deduped = dedupeByResolution(fromHtml, nykaaBaseKey, scoreNykaaImage);
  if (deduped.length > 0) return deduped;
  return jsonImages.filter((u) => NYKAA_CDN_RE.test(u));
}

export const NYKAA_HOSTNAMES = new Set(['nykaa.com', 'www.nykaa.com', 'nykaafashion.com', 'www.nykaafashion.com']);
export function isNykaa(hostname: string): boolean {
  return NYKAA_HOSTNAMES.has(normalizeHostname(hostname));
}
